/**
 * /webhooks — public webhook endpoints (no auth, no idempotency middleware)
 *
 * POST /webhooks/sumsub  — KYC applicant events
 * POST /webhooks/privy   — wallet linking events
 * POST /webhooks/helius  — Solana transaction events (log only; indexer is authoritative)
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { eq } from "drizzle-orm";
import { db, kycSessions } from "@comadre/db";
import {
  SumsubWebhookEvent,
  HeliusWebhookPayload,
} from "@comadre/types";
import { rootLogger } from "../middlewares/logger.js";
import pino from "pino";

export const webhooksRouter = new Hono();

function log(c: Context): pino.Logger {
  return rootLogger.child({ path: c.req.path });
}

// ---------------------------------------------------------------------------
// POST /webhooks/sumsub — KYC events
// ---------------------------------------------------------------------------
webhooksRouter.post("/sumsub", async (c) => {
  const logger = log(c);

  const webhookSecret = process.env["SUMSUB_WEBHOOK_SECRET"];

  let payload: unknown;

  if (webhookSecret) {
    const rawBody = await c.req.text();
    const digest = c.req.header("X-Payload-Digest");

    if (!digest) {
      return c.json({ error: "unauthorized", message: "Missing X-Payload-Digest" }, 401);
    }

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(webhookSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
    const expected = Array.from(new Uint8Array(sigBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    if (digest !== expected) {
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
    // STUB: on-chain update_kyc_tier call — pending anchor-client deploy
    logger.info("[sumsub] STUB: skipping on-chain update_kyc_tier (pending deploy)");
  }

  return c.json({ received: true }, 200);
});

// ---------------------------------------------------------------------------
// POST /webhooks/privy — wallet linking events (STUB)
// ---------------------------------------------------------------------------
webhooksRouter.post("/privy", async (c) => {
  const logger = log(c);
  const payload = await c.req.json().catch(() => null);
  logger.info({ payload }, "[privy] webhook received (stub)");
  return c.json({ received: true }, 200);
});

// ---------------------------------------------------------------------------
// POST /webhooks/helius — Solana tx events (log only)
// ---------------------------------------------------------------------------
webhooksRouter.post("/helius", async (c) => {
  const logger = log(c);

  const heliusSecret = process.env["HELIUS_WEBHOOK_SECRET"];
  if (heliusSecret) {
    const auth = c.req.header("Authorization");
    if (auth !== heliusSecret) {
      return c.json({ error: "unauthorized" }, 401);
    }
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
