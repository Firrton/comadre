/**
 * /api/v1/onboarding — phone-based user onboarding (no Privy JWT yet).
 *
 * POST /api/v1/onboarding/init { phone } → creates Privy user + Solana wallet.
 * No user-level auth required (the user has no identity yet), but callers
 * must be trusted internal services. The agent signs each request with
 * INTERNAL_HMAC_SECRET after Twilio has verified phone ownership upstream.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import twilio from "twilio";

import { onboardPhone } from "../lib/onboarding.js";
import { getLogger } from "../middlewares/logger.js";
import { upsertContactRoute } from "../lib/savings/contactCrypto.js";
import { db, authSessions, smartWallets, sessionKeys, users } from "@comadre/db";
import { sessionKey as walletSessionKey, kms as walletKms } from "@comadre/wallet-infra";

export const onboardingRouter = new Hono();

const InitBody = z.object({
  phone: z.string().regex(/^\+\d{6,15}$/, "phone must be E.164"),
});

const MAX_SIGNATURE_AGE_MS = 5 * 60 * 1000;

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

  return next();
};

onboardingRouter.post(
  "/init",
  requireInternalSignature,
  zValidator("json", InitBody, (result, c) => {
    if (!result.success) {
      return c.json({ error: "validation", issues: result.error.format() }, 400);
    }
  }),
  async (c) => {
    const { phone } = c.req.valid("json");
    const log = getLogger(c);

    try {
      const result = await onboardPhone(phone);
      await upsertContactRoute({
        userWallet: result.walletAddress,
        phoneE164: phone,
      });
      log.info(
        {
          phone: phone.slice(0, 4) + "..." + phone.slice(-3),
          walletAddress: result.walletAddress,
          alreadyExisted: result.alreadyExisted,
        },
        "user onboarded",
      );

      return c.json(
        {
          walletAddress: result.walletAddress,
          alreadyExisted: result.alreadyExisted,
        },
        200,
      );
    } catch (err) {
      log.error(
        { err, phone: phone.slice(0, 4) + "..." },
        "onboarding failed",
      );
      return c.json(
        {
          error: "ONBOARDING_FAILED",
          message: err instanceof Error ? err.message : String(err),
        },
        502,
      );
    }
  },
);

const MONAD_DEFAULT_CHAIN_ID = 10143;
const MAGIC_TOKEN_TTL_MS = 15 * 60 * 1000;
const SESSION_PK_TTL_SECONDS = 5 * 60;
const DAILY_PER_CALL_CAP_MICRO_USDC = 50_000_000n;
const DAILY_VALIDITY_MS = 30 * 24 * 60 * 60 * 1000;

interface SessionPkEntry {
  pk: string;
  address: string;
  expiresAt: number;
}
const sessionPkMemory = new Map<string, SessionPkEntry>();

function rememberSessionPk(token: string, pk: string, address: string): void {
  const expiresAt = Date.now() + SESSION_PK_TTL_SECONDS * 1000;
  sessionPkMemory.set(token, { pk, address, expiresAt });
  setTimeout(() => {
    const row = sessionPkMemory.get(token);
    if (row && row.expiresAt <= Date.now()) sessionPkMemory.delete(token);
  }, SESSION_PK_TTL_SECONDS * 1000).unref?.();
}

function takeSessionPk(token: string): SessionPkEntry | null {
  const row = sessionPkMemory.get(token);
  if (!row) return null;
  if (row.expiresAt <= Date.now()) {
    sessionPkMemory.delete(token);
    return null;
  }
  return row;
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

    const sid = process.env["TWILIO_ACCOUNT_SID"];
    const token = process.env["TWILIO_AUTH_TOKEN"];
    const from = process.env["TWILIO_SMS_FROM"];

    if (!sid || !token || !from) {
      log.warn(
        { hasSid: !!sid, hasToken: !!token, hasFrom: !!from },
        "[onboarding] Twilio SMS env missing; returning magicLink in response",
      );
      return c.json({ ok: true, magicLink }, 200);
    }

    await twilio(sid, token).messages.create({ from, to: phone, body: magicLink });
    return c.json({ ok: true }, 200);
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
  phoneJwt: z.string().optional(),
});

onboardingRouter.post(
  "/monad/finalize",
  zValidator("json", FinalizeBody, (result, c) => {
    if (!result.success) return c.json({ error: "validation", issues: result.error.format() }, 400);
  }),
  async (c) => {
    const { token, privyUserId, ownerAddress } = c.req.valid("json");
    const log = getLogger(c);

    const row = await loadPendingSession(token);
    if (!row) return c.json({ error: "not_found" }, 404);
    if (row.status !== "pending" || row.expiresAt.getTime() < Date.now()) {
      return c.json({ error: "expired" }, 410);
    }

    // V1: trust the token; phoneJwt verification deferred until Privy app config is wired through.
    log.info({ token: token.slice(0, 8) + "...", privyUserId, ownerAddress }, "[onboarding] monad finalize");

    await db
      .update(authSessions)
      .set({ privyUserId, ownerAddress: ownerAddress.toLowerCase() })
      .where(eq(authSessions.magicToken, token));

    const generated = walletSessionKey.generateSessionKey();
    rememberSessionPk(token, generated.privateKey, generated.address);

    return c.json({ sessionAddress: generated.address }, 200);
  },
);

const InstallBody = z.object({
  token: z.string().min(1),
  serializedBlob: z.string().min(1),
  smartWalletAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});

onboardingRouter.post(
  "/monad/install-session-key",
  zValidator("json", InstallBody, (result, c) => {
    if (!result.success) return c.json({ error: "validation", issues: result.error.format() }, 400);
  }),
  async (c) => {
    const { token, serializedBlob, smartWalletAddress } = c.req.valid("json");
    const log = getLogger(c);

    const row = await loadPendingSession(token);
    if (!row) return c.json({ error: "not_found" }, 404);
    if (row.status !== "pending" || row.expiresAt.getTime() < Date.now()) {
      return c.json({ error: "expired" }, 410);
    }
    if (!row.privyUserId || !row.ownerAddress) {
      return c.json({ error: "finalize_required" }, 409);
    }

    const sessionEntry = takeSessionPk(token);
    if (!sessionEntry) return c.json({ error: "session_expired" }, 410);

    const envelope = await walletKms.encryptSessionKey({
      blob: serializedBlob,
      sessionPrivateKey: sessionEntry.pk as `0x${string}`,
    });

    const chainId = Number(process.env["MONAD_CHAIN_ID"] ?? MONAD_DEFAULT_CHAIN_ID);
    const comadreAddr = process.env["COMADRE_CONTRACT_ADDRESS"] ?? "0x0";
    const usdcAddr = process.env["USDC_CONTRACT_ADDRESS"] ?? "0x0";
    const normalizedOwner = row.ownerAddress.toLowerCase();
    const normalizedSmart = smartWalletAddress.toLowerCase();
    const now = new Date();

    // Dual-identity period: legacy users.wallet still references Solana base58.
    // For Monad signups we insert a fresh row keyed by EVM ownerAddress.
    // If a row already exists for this phoneHash, reuse its wallet PK instead.
    const existingByPhone = await db
      .select({ wallet: users.wallet })
      .from(users)
      .where(eq(users.phoneHash, row.phoneHash))
      .limit(1);

    const userWallet = existingByPhone[0]?.wallet ?? normalizedOwner;
    if (!existingByPhone[0]) {
      await db.insert(users).values({
        wallet: normalizedOwner,
        phoneHash: row.phoneHash,
        kycTier: "t0_demo",
        reputationScore: 0,
        tandasCompleted: 0,
        tandasDefaulted: 0,
        tandasCreated: 0n,
        loansRepaid: 0,
        loansDefaulted: 0,
        createdAt: now,
        updatedAt: now,
      });
    }

    const inserted = await db
      .insert(smartWallets)
      .values({
        userWallet,
        privyUserId: row.privyUserId,
        ownerAddress: normalizedOwner,
        smartWalletAddress: normalizedSmart,
        chainId,
      })
      .returning({ id: smartWallets.id });

    const smartWalletId = inserted[0]!.id;

    await db.insert(sessionKeys).values({
      smartWalletId,
      kind: "daily",
      sessionAddress: sessionEntry.address.toLowerCase(),
      // TODO(monad-onboarding): extract on-chain permissionId from serializedBlob.
      permissionId: "",
      ciphertext: envelope.ciphertext,
      dekCiphertext: envelope.dekCiphertext,
      iv: envelope.iv,
      encryptionVersion: envelope.encryptionVersion,
      policiesJson: { kind: "daily", cap: 50 },
      perCallCapMicroUsdc: DAILY_PER_CALL_CAP_MICRO_USDC,
      allowedContracts: [comadreAddr, usdcAddr],
      allowedRecipients: [],
      validUntil: new Date(now.getTime() + DAILY_VALIDITY_MS),
      status: "active",
    });

    await db
      .update(authSessions)
      .set({ status: "completed", completedAt: now })
      .where(and(eq(authSessions.magicToken, token), eq(authSessions.status, "pending")));

    sessionPkMemory.delete(token);
    log.info({ smartWalletId, normalizedSmart }, "[onboarding] monad session key installed");

    return c.json({ ok: true, smartWalletAddress: normalizedSmart }, 200);
  },
);
