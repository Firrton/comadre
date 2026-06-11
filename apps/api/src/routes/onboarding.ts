/**
 * /api/v1/onboarding — phone-based user onboarding (Monad).
 *
 * Internal-HMAC-authenticated routes (agent → API):
 *   POST /monad/start                    (issue magic-link)
 *
 * Magic-token-authenticated routes (browser → API):
 *   GET  /monad/session/:token
 *   POST /monad/finalize                 (now requires phoneJwt — see COM-026)
 *   POST /monad/install-session-key      (now wrapped in db.transaction — see COM-009)
 *
 * NOTE: POST /init (legacy Solana onboarding) returns 410 — removed in Monad migration.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getLogger } from "../middlewares/logger.js";
import { db, authSessions, smartWallets, sessionKeys, users } from "@comadre/db";
import {
  sessionKey as walletSessionKey,
  privy as walletPrivy,
} from "@comadre/wallet-infra";
import {
  markNonceSeen,
  putOnboardingHandshake,
  takeOnboardingHandshake,
} from "@comadre/cache";

export const onboardingRouter = new Hono();

// Audit COM-022: tightened from 5 min to 90s. With anti-replay nonce dedup
// below, this narrows the replay window to clock-skew tolerance only.
const MAX_SIGNATURE_AGE_MS = 90 * 1000;

// Audit COM-022: in-process nonce dedup for HMAC signatures. A signature can
// only be consumed once within MAX_SIGNATURE_AGE_MS. Process-local — fine for
// single-instance deploys; horizontal scaling would need Redis (deferred).
const seenSignatures = new Map<string, number>();
function pruneSeenSignatures(now: number): void {
  if (seenSignatures.size < 1024) return;
  for (const [sig, expiresAt] of seenSignatures) {
    if (expiresAt <= now) seenSignatures.delete(sig);
  }
}

function signInternalRequest(secret: string, method: string, path: string, body: string, timestamp: string): string {
  const payload = `${method}\n${path}\n${timestamp}\n${body}`;
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(a) || !/^[0-9a-f]{64}$/i.test(b)) return false;

  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length !== right.length) return false;

  return timingSafeEqual(left, right);
}

export const requireInternalSignature: MiddlewareHandler = async (c, next) => {
  const log = getLogger(c);
  const secret = process.env["INTERNAL_HMAC_SECRET"];

  if (!secret || secret.length < 32) {
    log.error("[onboarding] INTERNAL_HMAC_SECRET missing or too short");
    return c.json({ error: "server_misconfigured" }, 500);
  }

  const signature = c.req.header("X-Internal-Signature");
  const timestamp = c.req.header("X-Internal-Timestamp");

  if (!signature || !timestamp) {
    return c.json({ error: "unauthorized", message: "Missing internal signature" }, 401);
  }

  const timestampMs = Number(timestamp);
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > MAX_SIGNATURE_AGE_MS) {
    return c.json({ error: "unauthorized", message: "Invalid or expired internal signature" }, 401);
  }

  const body = await c.req.raw.clone().text();
  const expected = signInternalRequest(secret, c.req.method, c.req.path, body, timestamp);

  if (!safeEqualHex(signature, expected)) {
    return c.json({ error: "unauthorized", message: "Invalid internal signature" }, 401);
  }

  // Audit COM-022: reject signature replay within the validity window.
  // Redis path (when available): SET NX EX — atomic across instances.
  // Fallback: in-memory seenSignatures Map (single-instance, safe for test/dev).
  const now = Date.now();
  let fresh: boolean;
  try {
    fresh = await markNonceSeen(signature, Math.ceil(MAX_SIGNATURE_AGE_MS / 1000));
  } catch {
    // markNonceSeen already falls back to memory internally; this outer catch
    // guards against any unexpected throw so the API stays up.
    pruneSeenSignatures(now);
    const seenExpiresAt = seenSignatures.get(signature);
    fresh = !(seenExpiresAt && seenExpiresAt > now);
    if (fresh) seenSignatures.set(signature, now + MAX_SIGNATURE_AGE_MS);
  }
  if (!fresh) {
    log.warn({ path: c.req.path }, "[onboarding] HMAC replay rejected");
    return c.json({ error: "unauthorized", message: "Signature already used" }, 401);
  }

  return next();
};

// POST /init (legacy Solana onboarding) — removed during Monad migration.
// Use /monad/start instead.
onboardingRouter.post("/init", requireInternalSignature, (c) =>
  c.json({ error: "gone", message: "Solana onboarding removed. Use /monad/start." }, 410),
);

const MONAD_DEFAULT_CHAIN_ID = 10143;
const MAGIC_TOKEN_TTL_MS = 15 * 60 * 1000;
const SESSION_PK_TTL_SECONDS = 5 * 60;
const DAILY_PER_CALL_CAP_MICRO_USDC = 50_000_000n;
const DAILY_VALIDITY_MS = 30 * 24 * 60 * 60 * 1000;

// In-memory fallback for sessionAgent is managed inside packages/cache/src/apiState.ts.
// takeOnboardingHandshake returns { subOrgId, walletId, agentAddress } or null.
interface SessionAgentEntry {
  subOrgId: string;
  walletId: string;
  agentAddress: string;
  expiresAt: number;
}

async function rememberSessionAgent(
  token: string,
  provisioned: { subOrgId: string; walletId: string; agentAddress: string },
): Promise<void> {
  await putOnboardingHandshake(token, provisioned, SESSION_PK_TTL_SECONDS);
}

async function takeSessionAgent(token: string): Promise<SessionAgentEntry | null> {
  const data = await takeOnboardingHandshake(token);
  if (!data) return null;
  // Synthesize expiresAt for API compatibility; Redis TTL is the real authority.
  return { ...data, expiresAt: Date.now() + SESSION_PK_TTL_SECONDS * 1000 };
}

function hashPhoneSync(e164: string): string {
  return createHash("sha256").update(e164).digest("hex");
}

const StartBody = z.object({
  phone: z.string().regex(/^\+\d{6,15}$/, "phone must be E.164"),
});

onboardingRouter.post(
  "/monad/start",
  requireInternalSignature,
  zValidator("json", StartBody, (result, c) => {
    if (!result.success) return c.json({ error: "validation", issues: result.error.format() }, 400);
  }),
  async (c) => {
    const { phone } = c.req.valid("json");
    const log = getLogger(c);

    const phoneHash = hashPhoneSync(phone);
    const magicToken = randomBytes(24).toString("base64url");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + MAGIC_TOKEN_TTL_MS);

    // Audit COM-034: cancel any prior pending tokens for this phone so two
    // concurrent magic links can't coexist (race + ATO surface).
    await db
      .update(authSessions)
      .set({ status: "cancelled" })
      .where(and(eq(authSessions.phoneHash, phoneHash), eq(authSessions.status, "pending")));

    await db.insert(authSessions).values({
      phoneHash,
      magicToken,
      status: "pending",
      expiresAt,
      createdAt: now,
    });

    const baseUrl = process.env["ONBOARDING_BASE_URL"];
    if (!baseUrl) {
      log.error("[onboarding] ONBOARDING_BASE_URL not set");
      return c.json({ error: "server_misconfigured" }, 500);
    }
    const magicLink = `${baseUrl.replace(/\/$/, "")}/o/${magicToken}`;

    // SMS delivery is deferred (SMS provider removed; provider TBD).
    // The magic-link is returned in the response body — the agent forwards it to the user.
    return c.json({ ok: true, magicLink }, 200);
  },
);

async function loadPendingSession(token: string) {
  const rows = await db
    .select()
    .from(authSessions)
    .where(eq(authSessions.magicToken, token))
    .limit(1);
  return rows[0] ?? null;
}

onboardingRouter.get("/monad/session/:token", async (c) => {
  const token = c.req.param("token");
  const row = await loadPendingSession(token);
  if (!row) return c.json({ error: "not_found" }, 404);
  if (row.status !== "pending" || row.expiresAt.getTime() < Date.now()) {
    return c.json({ error: "expired" }, 410);
  }

  const privyAppId = process.env["PRIVY_APP_ID"];
  if (!privyAppId) {
    return c.json({ error: "server_misconfigured" }, 500);
  }

  return c.json(
    {
      privyAppId,
      chainId: Number(process.env["MONAD_CHAIN_ID"] ?? MONAD_DEFAULT_CHAIN_ID),
      comadreContractAddress: process.env["COMADRE_CONTRACT_ADDRESS"] ?? null,
      usdcAddress: process.env["USDC_CONTRACT_ADDRESS"] ?? null,
    },
    200,
  );
});

const FinalizeBody = z.object({
  token: z.string().min(1),
  privyUserId: z.string().min(1),
  ownerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  // Audit COM-026: now REQUIRED. Verified server-side against Privy.
  phoneJwt: z.string().min(1),
});

onboardingRouter.post(
  "/monad/finalize",
  zValidator("json", FinalizeBody, (result, c) => {
    if (!result.success) return c.json({ error: "validation", issues: result.error.format() }, 400);
  }),
  async (c) => {
    const { token, privyUserId, ownerAddress, phoneJwt } = c.req.valid("json");
    const log = getLogger(c);

    const row = await loadPendingSession(token);
    if (!row) return c.json({ error: "not_found" }, 404);
    if (row.status !== "pending" || row.expiresAt.getTime() < Date.now()) {
      return c.json({ error: "expired" }, 410);
    }

    // Audit COM-026: verify the Privy JWT. Confirms the caller authenticated
    // via Privy AND that the userId/ownerAddress/phone tuple is consistent.
    let claims;
    try {
      claims = await walletPrivy.verifyPrivyJwt(phoneJwt);
    } catch (err) {
      log.warn({ err }, "[onboarding] privy jwt verification failed");
      return c.json({ error: "unauthorized", message: "Invalid Privy JWT" }, 401);
    }
    if (claims.userId !== privyUserId) {
      return c.json({ error: "unauthorized", message: "userId mismatch" }, 401);
    }
    const normalizedOwner = ownerAddress.toLowerCase();
    if (!claims.ownerAddress || claims.ownerAddress.toLowerCase() !== normalizedOwner) {
      return c.json({ error: "unauthorized", message: "ownerAddress mismatch" }, 401);
    }
    const phoneMatches = claims.phoneNumbers.some(
      (p) => hashPhoneSync(p) === row.phoneHash,
    );
    if (!phoneMatches) {
      return c.json({ error: "unauthorized", message: "phone mismatch" }, 401);
    }

    log.info(
      { token: token.slice(0, 8) + "...", privyUserId, ownerAddress: normalizedOwner },
      "[onboarding] monad finalize",
    );

    await db
      .update(authSessions)
      .set({ privyUserId, ownerAddress: normalizedOwner })
      .where(eq(authSessions.magicToken, token));

    const provisioned = await walletSessionKey.provisionSessionKeyAgent({
      userExternalId: row.phoneHash,
      displayName: `comadre-agent-${row.phoneHash.slice(0, 8)}`,
    });
    await rememberSessionAgent(token, provisioned);

    return c.json({ sessionAddress: provisioned.agentAddress }, 200);
  },
);

const InstallBody = z.object({
  token: z.string().min(1),
  serializedBlob: z.string().min(1),
  smartWalletAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  // Audit COM-027: now REQUIRED. Re-verified server-side against the
  // privyUserId stored at finalize time.
  phoneJwt: z.string().min(1),
});

onboardingRouter.post(
  "/monad/install-session-key",
  zValidator("json", InstallBody, (result, c) => {
    if (!result.success) return c.json({ error: "validation", issues: result.error.format() }, 400);
  }),
  async (c) => {
    const { token, serializedBlob, smartWalletAddress, phoneJwt } = c.req.valid("json");
    const log = getLogger(c);

    const row = await loadPendingSession(token);
    if (!row) return c.json({ error: "not_found" }, 404);
    if (row.status !== "pending" || row.expiresAt.getTime() < Date.now()) {
      return c.json({ error: "expired" }, 410);
    }
    if (!row.privyUserId || !row.ownerAddress) {
      return c.json({ error: "finalize_required" }, 409);
    }

    // Audit COM-027: verify the Privy JWT against the user pinned at finalize.
    let claims;
    try {
      claims = await walletPrivy.verifyPrivyJwt(phoneJwt);
    } catch (err) {
      log.warn({ err }, "[onboarding] privy jwt verification failed at install");
      return c.json({ error: "unauthorized", message: "Invalid Privy JWT" }, 401);
    }
    if (claims.userId !== row.privyUserId) {
      return c.json({ error: "unauthorized", message: "userId mismatch" }, 401);
    }
    const normalizedOwner = row.ownerAddress.toLowerCase();
    if (!claims.ownerAddress || claims.ownerAddress.toLowerCase() !== normalizedOwner) {
      return c.json({ error: "unauthorized", message: "ownerAddress mismatch" }, 401);
    }

    const sessionAgent = await takeSessionAgent(token);
    if (!sessionAgent) return c.json({ error: "session_expired" }, 410);

    const chainId = Number(process.env["MONAD_CHAIN_ID"] ?? MONAD_DEFAULT_CHAIN_ID);
    const comadreAddr = process.env["COMADRE_CONTRACT_ADDRESS"] ?? "0x0";
    const usdcAddr = process.env["USDC_CONTRACT_ADDRESS"] ?? "0x0";
    const normalizedSmart = smartWalletAddress.toLowerCase();
    const now = new Date();

    // Audit COM-009: all four writes are atomic. A mid-flight crash either
    // leaves the auth_session pending (recoverable) or fully completes —
    // never the in-between state that previously orphaned smart_wallets rows.
    try {
      await db.transaction(async (tx) => {
        const existingByPhone = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.phoneHash, row.phoneHash))
          .limit(1);

        let userId = existingByPhone[0]?.id;
        if (!userId) {
          const inserted = await tx
            .insert(users)
            .values({
              phoneHash: row.phoneHash,
              ownerAddress: normalizedOwner,
              kycTier: "t0_demo",
              createdAt: now,
              updatedAt: now,
            })
            .returning({ id: users.id });
          userId = inserted[0]!.id;
        } else {
          await tx
            .update(users)
            .set({ ownerAddress: normalizedOwner, updatedAt: now })
            .where(eq(users.id, userId));
        }

        const insertedSmartWallet = await tx
          .insert(smartWallets)
          .values({
            userId,
            privyUserId: row.privyUserId!,
            ownerAddress: normalizedOwner,
            smartWalletAddress: normalizedSmart,
            chainId,
            agentWalletAddress: sessionAgent.agentAddress,
          })
          .returning({ id: smartWallets.id });

        const smartWalletId = insertedSmartWallet[0]!.id;

        await tx.insert(sessionKeys).values({
          smartWalletId,
          kind: "daily",
          sessionAddress: sessionAgent.agentAddress.toLowerCase(),
          // TODO COM-033: capture permissionId from on-chain install response.
          permissionId: "",
          turnkeySubOrgId: sessionAgent.subOrgId,
          turnkeyWalletId: sessionAgent.walletId,
          serializedPermission: serializedBlob,
          policiesJson: {},
          perCallCapMicroUsdc: DAILY_PER_CALL_CAP_MICRO_USDC,
          allowedContracts: [comadreAddr, usdcAddr],
          // TODO COM-004: populate from user contact allowlist; empty = no enforcement
          //               until contacts are added post-onboarding.
          allowedRecipients: [],
          validUntil: new Date(now.getTime() + DAILY_VALIDITY_MS),
          status: "active",
        });

        await tx
          .update(authSessions)
          .set({ status: "completed", completedAt: now })
          .where(
            and(eq(authSessions.magicToken, token), eq(authSessions.status, "pending")),
          );
      });
    } catch (err) {
      log.error({ err }, "[onboarding] install transaction failed");
      return c.json({ error: "install_failed", message: "Database transaction failed" }, 500);
    }

    log.info({ normalizedSmart }, "[onboarding] monad session key installed");

    return c.json({ ok: true, smartWalletAddress: normalizedSmart }, 200);
  },
);
