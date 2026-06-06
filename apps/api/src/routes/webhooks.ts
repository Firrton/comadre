/**
 * /webhooks — public webhook endpoints (no auth, no idempotency middleware)
 *
 * POST /webhooks/sumsub  — KYC applicant events
 * POST /webhooks/privy   — wallet linking events
 *
 * NOTE: POST /webhooks/helius (Solana transaction events) was removed in the Monad migration.
 * TODO(monad-webhook): replace with Monad indexer webhook when contracts are deployed.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { Context } from "hono";
import { eq } from "drizzle-orm";
import { db, kycSessions, users } from "@comadre/db";
import {
  SumsubWebhookEvent,
} from "@comadre/types";
import { rootLogger } from "../middlewares/logger.js";
import pino from "pino";

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
      const sessionRows = await db
        .select({ userId: kycSessions.userId })
        .from(kycSessions)
        .where(eq(kycSessions.applicantId, event.applicantId))
        .limit(1);

      const userId = sessionRows[0]?.userId;

      if (userId) {
        // Update users.kycTier in the DB
        await db
          .update(users)
          .set({ kycTier: "t2_standard", updatedAt: new Date() })
          .where(eq(users.id, userId));

        logger.info(
          { applicant_id: event.applicantId, userId, newTier: "t2_standard" },
          "[sumsub] user tier upgraded (DB only — TODO(monad-kyc): on-chain tier update pending)",
        );
        // TODO(monad-kyc): call Monad smart contract to update KYC tier on-chain
        // once the contract is deployed. Previously called upgradeKycTierOnChain()
        // via Solana Anchor program — removed in Monad migration.
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
// PRIVY_WEBHOOK_SECRET.
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
