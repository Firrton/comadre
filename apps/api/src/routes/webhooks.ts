/**
 * /webhooks — public webhook endpoints (no auth, no idempotency middleware)
 *
 * POST /webhooks/sumsub  — KYC applicant events
 * POST /webhooks/privy   — wallet linking events
 * POST /webhooks/helius  — Solana transaction events (log only; indexer is authoritative)
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { Context } from "hono";
import { eq } from "drizzle-orm";
import { PublicKey } from "@solana/web3.js";
import { Keypair } from "@solana/web3.js";
import { Wallet } from "@coral-xyz/anchor";
import { db, kycSessions, users } from "@comadre/db";
import {
  SumsubWebhookEvent,
  HeliusWebhookPayload,
} from "@comadre/types";
import { getComadreProgram } from "@comadre/anchor-client";
import {
  getConnection,
  getFeePayerKeypair,
  getKycOracleKeypair,
  buildUnsignedTx,
  submitWithRetry,
} from "@comadre/solana";
import { rootLogger } from "../middlewares/logger.js";
import { VersionedTransaction } from "@solana/web3.js";
import pino from "pino";

// ---------------------------------------------------------------------------
// Helper — promote a wallet's KYC tier on-chain
// ---------------------------------------------------------------------------

async function upgradeKycTierOnChain(walletAddress: string): Promise<void> {
  const connection = getConnection();
  const feePayer = getFeePayerKeypair();
  const kycOracle = getKycOracleKeypair();

  const walletPubkey = new PublicKey(walletAddress);
  const dummyWallet = new Wallet(Keypair.generate());
  const program = getComadreProgram(connection, dummyWallet);

  const kycIx = await program.methods
    .updateKycTier({ t2Standard: {} })
    .accounts({
      wallet: walletPubkey,
      kycOracle: kycOracle.publicKey,
    })
    .instruction();

  const built = await buildUnsignedTx({
    instructions: [kycIx],
    payer: feePayer,
    signers: [kycOracle],
  });

  const tx = VersionedTransaction.deserialize(Buffer.from(built.unsignedTxBase64, "base64"));
  await submitWithRetry(tx);
}

export const webhooksRouter = new Hono();

function log(c: Context): pino.Logger {
  return rootLogger.child({ path: c.req.path });
}

/**
 * Audit COM-023: timing-safe HMAC comparison. Plain `!==` on hex digests leaks
 * comparison length via timing. Decode both sides to Buffers of equal length
 * and use `crypto.timingSafeEqual`. Returns false on any malformed input.
 */
function timingSafeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

const IS_PRODUCTION = process.env["NODE_ENV"] === "production";

// ---------------------------------------------------------------------------
// POST /webhooks/sumsub — KYC events
// ---------------------------------------------------------------------------
webhooksRouter.post("/sumsub", async (c) => {
  const logger = log(c);

  const webhookSecret = process.env["SUMSUB_WEBHOOK_SECRET"];

  // Audit COM-024: fail CLOSED in production if the webhook secret is unset.
  // Previously an unset secret would silently accept every request — including
  // forged ones — which is catastrophic for a KYC channel.
  if (!webhookSecret) {
    if (IS_PRODUCTION) {
      logger.error("[sumsub] SUMSUB_WEBHOOK_SECRET unset in production — rejecting");
      return c.json({ error: "service_unavailable", message: "Webhook secret missing" }, 503);
    }
    logger.warn("[sumsub] SUMSUB_WEBHOOK_SECRET unset (dev only)");
  }

  let payload: unknown;

  if (webhookSecret) {
    const rawBody = await c.req.text();
    const digest = c.req.header("X-Payload-Digest");

    if (!digest) {
      return c.json({ error: "unauthorized", message: "Missing X-Payload-Digest" }, 401);
    }

    const expected = createHmac("sha256", webhookSecret).update(rawBody).digest("hex");

    // Audit COM-023: timing-safe comparison.
    if (!timingSafeHexEqual(digest, expected)) {
      logger.warn("[sumsub] HMAC mismatch");
      return c.json({ error: "unauthorized", message: "Invalid payload digest" }, 401);
    }

    try {
      payload = JSON.parse(rawBody);
    } catch {
      return c.json({ error: "bad_request", message: "Invalid JSON" }, 400);
    }
  } else {
    payload = await c.req.json().catch(() => null);
  }

  const parsed = SumsubWebhookEvent.safeParse(payload);
  if (!parsed.success) {
    return c.json({ error: "validation", issues: parsed.error.format() }, 400);
  }

  const event = parsed.data;
  logger.info({ event_type: event.type, applicant_id: event.applicantId }, "[sumsub] webhook received");

  if (event.type === "applicantReviewed") {
    const approved = event.reviewResult.reviewAnswer === "GREEN";
    const newStatus: "approved" | "rejected" = approved ? "approved" : "rejected";

    await db
      .update(kycSessions)
      .set({
        status: newStatus,
        reviewAnswer: event.reviewResult.reviewAnswer,
        updatedAt: new Date(),
      })
      .where(eq(kycSessions.applicantId, event.applicantId));

    logger.info({ applicant_id: event.applicantId, status: newStatus }, "[sumsub] kyc session updated");

    if (approved) {
      // Find the wallet address linked to this applicant
      const sessionRows = await db
        .select({ userWallet: kycSessions.userWallet })
        .from(kycSessions)
        .where(eq(kycSessions.applicantId, event.applicantId))
        .limit(1);

      const userWallet = sessionRows[0]?.userWallet;

      if (userWallet) {
        // Update users.kycTier in the DB
        await db
          .update(users)
          .set({ kycTier: "t2_standard", updatedAt: new Date() })
          .where(eq(users.wallet, userWallet));

        // Promote tier on-chain — wrapped so a failure doesn't block the 200 response
        try {
          await upgradeKycTierOnChain(userWallet);
          logger.info(
            { applicant_id: event.applicantId, userWallet, newTier: "t2_standard" },
            "[sumsub] user tier upgraded"
          );
        } catch (err) {
          logger.error(
            { err, applicant_id: event.applicantId, userWallet },
            "[sumsub] on-chain update_kyc_tier failed (DB already updated)"
          );
        }
      } else {
        logger.warn({ applicant_id: event.applicantId }, "[sumsub] approved but no matching kyc_session found");
      }
    }
  }

  return c.json({ received: true }, 200);
});

// ---------------------------------------------------------------------------
// POST /webhooks/privy — wallet linking events
//
// Audit COM-025: was previously unauthenticated. Now requires an HMAC-SHA256
// signature in `X-Privy-Signature` (hex), computed over the raw body using
// PRIVY_WEBHOOK_SECRET. Privy production uses Svix-style multi-sig; integrating
// the full Svix verifier is a follow-up (COM-025 phase 2). For now this closes
// the latent landmine — an unsigned request is rejected.
// ---------------------------------------------------------------------------
webhooksRouter.post("/privy", async (c) => {
  const logger = log(c);
  const webhookSecret = process.env["PRIVY_WEBHOOK_SECRET"];

  if (!webhookSecret) {
    if (IS_PRODUCTION) {
      logger.error("[privy] PRIVY_WEBHOOK_SECRET unset in production — rejecting");
      return c.json({ error: "service_unavailable" }, 503);
    }
    logger.warn("[privy] PRIVY_WEBHOOK_SECRET unset (dev only); accepting unsigned");
    const payload = await c.req.json().catch(() => null);
    logger.info({ payload }, "[privy] webhook received (dev, unsigned)");
    return c.json({ received: true }, 200);
  }

  const rawBody = await c.req.text();
  const signature = c.req.header("X-Privy-Signature");
  if (!signature) {
    return c.json({ error: "unauthorized", message: "Missing X-Privy-Signature" }, 401);
  }
  const expected = createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  if (!timingSafeHexEqual(signature, expected)) {
    logger.warn("[privy] HMAC mismatch");
    return c.json({ error: "unauthorized" }, 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "bad_request", message: "Invalid JSON" }, 400);
  }

  logger.info({ payload }, "[privy] webhook received");
  return c.json({ received: true }, 200);
});

// ---------------------------------------------------------------------------
// POST /webhooks/helius — Solana tx events (log only)
// ---------------------------------------------------------------------------
webhooksRouter.post("/helius", async (c) => {
  const logger = log(c);

  const heliusSecret = process.env["HELIUS_WEBHOOK_SECRET"];
  if (heliusSecret) {
    const auth = c.req.header("Authorization") ?? "";
    // Audit COM-023 (Helius variant): timing-safe equality on shared-secret check.
    const a = Buffer.from(auth);
    const b = Buffer.from(heliusSecret);
    const ok = a.length === b.length && timingSafeEqual(a, b);
    if (!ok) {
      return c.json({ error: "unauthorized" }, 401);
    }
  } else if (IS_PRODUCTION) {
    return c.json({ error: "service_unavailable", message: "Webhook secret missing" }, 503);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = HeliusWebhookPayload.safeParse(body);

  if (!parsed.success) {
    // Return 200 to suppress Helius retries on schema mismatch
    logger.warn({ err: parsed.error.format() }, "[helius] invalid payload shape, returning 200 to suppress retries");
    return c.json({ received: true }, 200);
  }

  for (const tx of parsed.data) {
    logger.info(
      { signature: tx.signature, type: tx.type },
      "[helius] tx event received (log only — apps/indexer is authoritative)"
    );
  }

  return c.json({ received: true }, 200);
});
