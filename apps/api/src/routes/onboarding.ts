/**
 * /api/v1/onboarding — phone-based user onboarding (no Privy JWT yet).
 *
 * POST /api/v1/onboarding/init { phone } → creates Privy user + Solana wallet.
 * No user-level auth required (the user has no identity yet), but callers
 * must be trusted internal services. The agent signs each request with
 * INTERNAL_HMAC_SECRET after Twilio has verified phone ownership upstream.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import { onboardPhone } from "../lib/onboarding.js";
import { getLogger } from "../middlewares/logger.js";
import { upsertContactRoute } from "../lib/savings/contactCrypto.js";

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

const requireInternalSignature: MiddlewareHandler = async (c, next) => {
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
