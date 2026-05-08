import { createHmac, timingSafeEqual } from "node:crypto";

import { Hono } from "hono";
import { logger } from "hono/logger";
import pino from "pino";
import { z } from "zod";

import { env } from "@comadre/config";

import { sendWhatsAppMessage } from "./sendMessage.js";
import { verifyTwilioSignature } from "./verifySignature.js";

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
  const profileName = params.ProfileName ?? "";

  log.info(
    { from, messageSid, profileName, len: body.length },
    "inbound whatsapp",
  );

  // Forward to agent service
  try {
    const res = await fetch(env.AGENT_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from, body, conversationKey: from }),
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
// POST /reply (internal, HMAC-authed)
// ---------------------------------------------------------------------------
app.post("/reply", async (c) => {
  const provided = c.req.header("X-Internal-Auth") ?? "";
  if (provided.length === 0) {
    return c.json({ error: "missing X-Internal-Auth" }, 401);
  }

  const raw = await c.req.text();

  const expected = createHmac("sha256", env.INTERNAL_HMAC_SECRET)
    .update(raw)
    .digest("hex");

  const a = Buffer.from(provided, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return c.json({ error: "invalid auth" }, 401);
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
