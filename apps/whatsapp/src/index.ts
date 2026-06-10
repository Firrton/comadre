import { createHmac, timingSafeEqual } from "node:crypto";

import * as Sentry from "@sentry/bun";
import { Hono } from "hono";
import { logger } from "hono/logger";
import pino from "pino";
import { z } from "zod";

import { webhookRateLimit, checkRateLimit, markMessageSeen, markNonceSeen } from "@comadre/cache";
import { env } from "@comadre/config";

import { sendWhatsAppMessage } from "./lib/sendMessage.js";
import { verifyTwilioSignature } from "./lib/verifySignature.js";

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.NODE_ENV === "production" ? 0.1 : 1.0,
  });
}

const log = pino({ name: "whatsapp" });

const replyBodySchema = z.object({
  to: z.string().regex(/^whatsapp:\+\d+$/, 'Expected "whatsapp:+E164"'),
  body: z.string().min(1).max(4096),
});

interface AgentResponse {
  reply: string;
}

const app = new Hono();
app.use("*", logger());

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------
app.get("/health", (c) => c.json({ ok: true, service: "whatsapp" }));

// ---------------------------------------------------------------------------
// POST /webhook (Twilio inbound)
// ---------------------------------------------------------------------------
app.post("/webhook", async (c) => {
  const signature = c.req.header("X-Twilio-Signature") ?? "";
  // Twilio uses the EXACT URL it sent the request to for signature computation.
  // For ngrok in dev, set WA_URL to your ngrok https URL.
  const url = `${env.WA_URL}/webhook`;

  const form = await c.req.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    if (typeof v === "string") params[k] = v;
  }

  const valid = verifyTwilioSignature({
    authToken: env.TWILIO_AUTH_TOKEN,
    signature,
    url,
    params,
  });

  if (!valid) {
    log.warn({ url, hasSig: signature.length > 0 }, "twilio signature invalid");
    return c.text("invalid signature", 403);
  }

  const from = params.From ?? "";
  const body = params.Body ?? "";
  const messageSid = params.MessageSid ?? "";
  // profileName intentionally not read — WhatsApp display name is PII and not needed for processing

  const sender = redactPhoneForLog(from.replace(/^whatsapp:/i, ""));

  log.info(
    { sender, messageSid, len: body.length },
    "inbound whatsapp",
  );

  if (process.env["SKIP_REDIS"] !== "true" && process.env["NODE_ENV"] !== "test") {
    try {
      const rl = await checkRateLimit(webhookRateLimit, from);
      if (!rl.allowed) {
        log.warn({ sender, resetAt: rl.resetAt }, "webhook rate limited");
        return c.body('<?xml version="1.0" encoding="UTF-8"?><Response/>', 429);
      }
    } catch (rlErr) {
      log.warn({ err: rlErr, sender }, "[rateLimit] Redis unavailable, allowing through");
    }
  }

  // Dedup on Twilio MessageSid — Twilio retries webhooks on network errors,
  // which can re-trigger the agent with the same message. Skip if already seen.
  if (
    messageSid.length > 0 &&
    process.env["SKIP_REDIS"] !== "true" &&
    process.env["NODE_ENV"] !== "test"
  ) {
    try {
      const isDuplicate = await markMessageSeen(messageSid);
      if (isDuplicate) {
        log.info({ from, messageSid }, "duplicate MessageSid, skipping agent forward");
        return c.body('<?xml version="1.0" encoding="UTF-8"?><Response/>', 200, {
          "content-type": "text/xml",
        });
      }
    } catch (dedupErr) {
      log.warn({ err: dedupErr, from, messageSid }, "[dedup] Redis unavailable, allowing through");
    }
  }

  // Forward to agent service /process endpoint (HMAC-signed)
  try {
    const bodyStr = JSON.stringify({ from, body, conversationKey: from });
    const timestamp = String(Date.now());
    const hmacPayload = `POST\n/process\n${timestamp}\n${bodyStr}`;
    const hmacSignature = createHmac("sha256", env.INTERNAL_HMAC_SECRET)
      .update(hmacPayload)
      .digest("hex");

    const res = await fetch(`${env.AGENT_URL}/process`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Internal-Signature": hmacSignature,
        "X-Internal-Timestamp": timestamp,
      },
      body: bodyStr,
    });

    if (!res.ok) {
      log.error({ status: res.status }, "agent responded non-2xx");
    } else {
      const json = (await res.json()) as Partial<AgentResponse>;
      const reply = typeof json.reply === "string" ? json.reply.trim() : "";

      if (reply.length > 0 && from.length > 0) {
        try {
          const sent = await sendWhatsAppMessage(from, reply);
          log.info({ messageSid: sent.messageSid }, "reply sent");
        } catch (err) {
          log.error({ err }, "failed to send twilio reply");
        }
      }
    }
  } catch (err) {
    log.error({ err }, "failed to reach agent service");
  }

  // Always return empty TwiML (Twilio expects this — outbound is via REST API)
  return c.body('<?xml version="1.0" encoding="UTF-8"?><Response/>', 200, {
    "content-type": "text/xml",
  });
});

// ---------------------------------------------------------------------------
// Internal auth helpers for /reply
// ---------------------------------------------------------------------------
const REPLY_MAX_AGE_MS = 300_000; // 5 minutes

/**
 * Build a timestamped HMAC-SHA256 signature for outbound calls to /reply.
 * Mirrors the pattern used by packages/agent-tools/src/apiClient.ts.
 */
export function signReplyRequest(
  secret: string,
  timestamp: string,
  body: string,
): string {
  return createHmac("sha256", secret)
    .update(`POST\n/reply\n${timestamp}\n${body}`)
    .digest("hex");
}

// ---------------------------------------------------------------------------
// POST /reply (internal, HMAC-authed)
// ---------------------------------------------------------------------------
app.post("/reply", async (c) => {
  const signature = c.req.header("X-Internal-Signature") ?? "";
  const timestamp = c.req.header("X-Internal-Timestamp") ?? "";

  if (!signature || !timestamp) {
    return c.json({ error: "missing X-Internal-Signature or X-Internal-Timestamp" }, 401);
  }

  const age = Date.now() - Number(timestamp);
  if (!timestamp || Number.isNaN(age) || age > REPLY_MAX_AGE_MS || age < -30_000) {
    log.warn({ hasTimestamp: timestamp.length > 0 }, "reply HMAC timestamp rejected");
    return c.json({ error: "request expired or invalid timestamp" }, 401);
  }

  const raw = await c.req.text();

  const expected = signReplyRequest(env.INTERNAL_HMAC_SECRET, timestamp, raw);

  const a = Buffer.from(signature, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    log.warn("HMAC signature mismatch on /reply");
    return c.json({ error: "invalid signature" }, 401);
  }

  const fresh = await markNonceSeen(signature, 300);
  if (!fresh) {
    log.warn("replay detected on /reply");
    return c.json({ error: "replayed request" }, 401);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  const parsed = replyBodySchema.safeParse(parsedJson);
  if (!parsed.success) {
    return c.json(
      { error: "invalid body", issues: parsed.error.flatten() },
      400,
    );
  }

  try {
    const sent = await sendWhatsAppMessage(parsed.data.to, parsed.data.body);
    return c.json({ messageSid: sent.messageSid });
  } catch (err) {
    log.error({ err }, "twilio send failed");
    return c.json({ error: "twilio send failed" }, 502);
  }
});

const port = Number(process.env.PORT ?? 3002);
export default { port, fetch: app.fetch };
export { app };

/** Redact an E.164 phone number for safe logging: "+52...72" */
function redactPhoneForLog(phone: string): string {
  if (phone.length <= 5) return "<redacted>";
  return `${phone.slice(0, 3)}…${phone.slice(-2)}`;
}
