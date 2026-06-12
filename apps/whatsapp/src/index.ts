import { createHmac, timingSafeEqual } from "node:crypto";

import * as Sentry from "@sentry/bun";
import { Hono } from "hono";
import { logger } from "hono/logger";
import pino from "pino";
import { z } from "zod";

import { webhookRateLimit, checkRateLimit, markMessageSeen, markNonceSeen } from "@comadre/cache";
import { env } from "@comadre/config";

import { sendWhatsAppMessage } from "./lib/sendMessage.js";
import { openWaEnvelope, verifyOpenWaSignature } from "./lib/openwaInbound.js";
import { jidToWhatsAppAddress } from "./lib/jid.js";
import { bootstrapOpenWa } from "./lib/openwaBootstrap.js";

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
// POST /webhooks/whatsapp (OpenWA inbound)
//
// Filter pipeline (exact order per design §2.3):
//   1. Read raw body once
//   2. Signature verify (skipped in NODE_ENV=test)
//   3. JSON parse + schema validate
//   4. Event type filter (X-OpenWA-Event header)
//   5. fromMe / group / self-loop drop
//   6. Type filter (non-text drop)
//   7. Rate limit
//   8. Dedup (skipped in test / SKIP_REDIS=true)
//   9. Normalize JID → whatsapp:+E164
//  10. Forward to /process (HMAC-signed)
//  11. Ack {ok:true}
// ---------------------------------------------------------------------------
app.post("/webhooks/whatsapp", async (c) => {
  // Step 1 — Read raw body once; all downstream parsing uses this string
  const raw = await c.req.text();

  // Step 2 — Signature verification
  // Bypassed in NODE_ENV=test (mirrors agent HMAC bypass in index.test.ts:187-224).
  // In all other environments: fail closed on missing or invalid signature.
  if (process.env["NODE_ENV"] !== "test") {
    const signature = c.req.header("X-OpenWA-Signature") ?? "";
    const valid = verifyOpenWaSignature({
      secret: env.OPENWA_WEBHOOK_SECRET,
      signature,
      rawBody: raw,
    });
    if (!valid) {
      log.warn({ hasSig: signature.length > 0 }, "openwa signature invalid");
      return c.json({ error: "invalid signature" }, 403);
    }
  }

  // Step 3 — Parse JSON from raw string; validate envelope
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    log.warn("openwa webhook: invalid json body");
    return c.json({ error: "invalid json" }, 400);
  }

  const envelope = openWaEnvelope.safeParse(parsed);
  if (!envelope.success) {
    log.warn({ issues: envelope.error.flatten() }, "openwa webhook: invalid envelope");
    return c.json({ error: "invalid payload", issues: envelope.error.flatten() }, 400);
  }

  const { data } = envelope.data;

  // Step 4 — Event type filter: only process "message.received"
  // X-OpenWA-Event header is authoritative; body `event` field is advisory.
  const eventHeader = c.req.header("X-OpenWA-Event") ?? envelope.data.event ?? "";
  if (eventHeader !== "" && eventHeader !== "message.received") {
    return c.json({ ok: true, ignored: "event" });
  }

  // Step 5 — fromMe / group / self-loop drop
  if (data.fromMe === true) {
    return c.json({ ok: true, ignored: "fromMe" });
  }
  if (data.isGroup === true || data.from.endsWith("@g.us")) {
    return c.json({ ok: true, ignored: "group" });
  }
  if (data.to !== undefined && data.from === data.to) {
    return c.json({ ok: true, ignored: "self-loop" });
  }

  // Step 6 — Type filter: drop non-text messages (media out of scope)
  if (data.type !== undefined && data.type !== "chat" && data.body.length === 0) {
    return c.json({ ok: true, ignored: "non-text" });
  }

  // Step 7 — Rate limiting (skipped when Redis unavailable or in test)
  if (process.env["SKIP_REDIS"] !== "true" && process.env["NODE_ENV"] !== "test") {
    try {
      const rl = await checkRateLimit(webhookRateLimit, data.from);
      if (!rl.allowed) {
        log.warn({ from: redactJidForLog(data.from), resetAt: rl.resetAt }, "webhook rate limited");
        return c.json({ ok: false }, 429);
      }
    } catch (rlErr) {
      log.warn({ err: rlErr }, "[rateLimit] Redis unavailable, allowing through");
    }
  }

  // Step 8 — Dedup on OpenWA message id (data.id = msg.id._serialized)
  // Gated by SKIP_REDIS and NODE_ENV (same discipline as the rate-limit guard above).
  if (
    data.id.length > 0 &&
    process.env["SKIP_REDIS"] !== "true" &&
    process.env["NODE_ENV"] !== "test"
  ) {
    try {
      const isDuplicate = await markMessageSeen(data.id);
      if (isDuplicate) {
        log.info({ from: redactJidForLog(data.from), msgId: data.id }, "duplicate message id, skipping forward");
        return c.json({ ok: true, deduped: true });
      }
    } catch (dedupErr) {
      log.warn({ err: dedupErr, msgId: data.id }, "[dedup] Redis unavailable, allowing through");
    }
  }

  // Step 9 — Normalize JID → canonical whatsapp:+E164 address
  const addr = jidToWhatsAppAddress(data.from);
  if (addr === null) {
    log.warn({ jid: data.from }, "openwa webhook: invalid or non-individual JID, dropping");
    return c.json({ ok: true, ignored: "badjid" });
  }

  const senderLog = redactPhoneForLog(addr.replace(/^whatsapp:/, ""));
  log.info(
    { sender: senderLog, msgId: data.id, len: data.body.length },
    "inbound whatsapp",
  );

  // Step 10 — Forward to agent service /process (HMAC-signed)
  try {
    const bodyStr = JSON.stringify({ from: addr, body: data.body, conversationKey: addr });
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

      if (reply.length > 0 && addr.length > 0) {
        try {
          const sent = await sendWhatsAppMessage(addr, reply);
          log.info({ messageId: sent.messageId }, "reply sent");
        } catch (err) {
          log.error({ err }, "failed to send openwa reply");
        }
      }
    }
  } catch (err) {
    log.error({ err }, "failed to reach agent service");
  }

  // Step 11 — Ack
  return c.json({ ok: true });
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

  const parsedBody = replyBodySchema.safeParse(parsedJson);
  if (!parsedBody.success) {
    return c.json(
      { error: "invalid body", issues: parsedBody.error.flatten() },
      400,
    );
  }

  try {
    const sent = await sendWhatsAppMessage(parsedBody.data.to, parsedBody.data.body);
    return c.json({ messageId: sent.messageId });
  } catch (err) {
    log.error({ err }, "send failed");
    return c.json({ error: "send failed" }, 502);
  }
});

// ---------------------------------------------------------------------------
// Startup — bootstrap OpenWA session + webhook subscription
// Guarded by NODE_ENV !== "test" (mirrors Sentry guard at the top of the file).
// bootstrapOpenWa() swallows all failures internally — it must NEVER crash
// the service even if the OpenWA container is unreachable.
// ---------------------------------------------------------------------------
if (process.env["NODE_ENV"] !== "test") {
  bootstrapOpenWa().catch(() => {
    // Already logged inside bootstrapOpenWa; this outer catch prevents an
    // unhandled rejection in case of an unexpected synchronous throw.
  });
}

const port = Number(process.env.PORT ?? 3002);
export default { port, fetch: app.fetch };
export { app };

/** Redact an E.164 phone number for safe logging: "+52...72" */
function redactPhoneForLog(phone: string): string {
  if (phone.length <= 5) return "<redacted>";
  return `${phone.slice(0, 3)}…${phone.slice(-2)}`;
}

/** Redact a WhatsApp JID for safe logging: "549...@c.us" */
function redactJidForLog(jid: string): string {
  const atIdx = jid.indexOf("@");
  if (atIdx <= 5) return "<redacted>";
  const number = jid.slice(0, atIdx);
  const suffix = jid.slice(atIdx);
  return `${number.slice(0, 3)}…${number.slice(-2)}${suffix}`;
}
