import { createHmac, timingSafeEqual } from "node:crypto";

import * as Sentry from "@sentry/bun";
import { Hono } from "hono";
import { logger } from "hono/logger";
import pino from "pino";
import { z } from "zod";

import { agentToolRateLimit, checkRateLimit } from "@comadre/cache";
import { env } from "@comadre/config";
import { resolveTransferConfirmation } from "@comadre/agent-tools";

import { runAgent } from "./agentLoop.js";
import { loadHistory, saveHistory } from "./lib/conversationStore.js";
import { normalizePhoneE164 } from "./lib/phoneNormalize.js";
import { loadSavingsContext } from "./lib/savingsContext.js";
import { resolveUserFromTwilio } from "./lib/userResolver.js";
import { shouldNudgeGuardadito, recordGuardaditoNudge } from "./lib/nudgeGate.js";

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.NODE_ENV === "production" ? 0.1 : 1.0,
  });
}

const log = pino({ name: "agent" });

export const processDeps = {
  runAgent,
  resolveTransferConfirmation,
};

const processBodySchema = z.object({
  from: z.string().min(1),
  body: z.string().min(1),
  conversationKey: z.string().min(1),
});

const app = new Hono();
app.use("*", logger());

app.get("/health", (c) => c.json({ ok: true, service: "agent" }));

app.post("/process", async (c) => {
  // ── HMAC verification (skipped in test) ─────────────────────────────────
  const raw = await c.req.text();

  if (process.env["NODE_ENV"] !== "test") {
    const signature = c.req.header("X-Internal-Signature") ?? "";
    const timestamp = c.req.header("X-Internal-Timestamp") ?? "";
    const age = Date.now() - Number(timestamp);

    if (!timestamp || Number.isNaN(age) || age > 300_000 || age < -30_000) {
      log.warn({ hasTimestamp: timestamp.length > 0 }, "HMAC timestamp rejected");
      return c.json({ error: "request expired or invalid timestamp" }, 401);
    }

    const expected = createHmac("sha256", env.INTERNAL_HMAC_SECRET)
      .update(`POST\n/process\n${timestamp}\n${raw}`)
      .digest("hex");

    const a = Buffer.from(signature, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      log.warn("HMAC signature mismatch on /process");
      return c.json({ error: "invalid signature" }, 401);
    }
  }

  // ── Parse body ──────────────────────────────────────────────────────────
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(raw);
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  const parsed = processBodySchema.safeParse(parsedBody);
  if (!parsed.success) {
    return c.json(
      { error: "invalid body", issues: parsed.error.flatten() },
      400,
    );
  }

  const { from, body, conversationKey } = parsed.data;
  const senderPhone = normalizePhoneE164(
    from.replace(/^[^:]+:/, "").trim(),
  );
  const senderLogKey = redactPhoneForLog(senderPhone);

  // ── Rate limiting (skipped in test / when Redis unavailable) ────────────
  if (process.env["SKIP_REDIS"] !== "true" && process.env["NODE_ENV"] !== "test") {
    try {
      const rl = await checkRateLimit(agentToolRateLimit, conversationKey);
      if (!rl.allowed) {
        const retryAfter = Math.ceil((rl.resetAt.getTime() - Date.now()) / 1000);
        log.warn({ conversationKey, retryAfter }, "agent rate limited");
        return c.json({ error: "rate_limit_exceeded", retry_after: retryAfter }, 429);
      }
    } catch (rlErr) {
      log.warn({ err: rlErr }, "[rateLimit] Redis unavailable, allowing through");
    }
  }

  // ── Agent execution ─────────────────────────────────────────────────────
  const start = Date.now();

  try {
    try {
      const confirmation = await processDeps.resolveTransferConfirmation(senderPhone, body);
      if (confirmation.handled) {
        log.info(
          {
            sender: senderLogKey,
            outcome: confirmation.outcome,
            latencyMs: Date.now() - start,
            len: confirmation.reply.length,
          },
          "agent confirmation handled",
        );
        return c.json({ reply: confirmation.reply });
      }
    } catch (confirmationErr) {
      log.warn({ err: confirmationErr, sender: senderLogKey }, "transfer confirmation resolve failed");
    }

    let userId: string | null = null;
    try {
      const resolved = await resolveUserFromTwilio(senderPhone);
      userId = resolved?.userId ?? null;
    } catch (resolveErr) {
      log.error({ err: resolveErr, sender: senderLogKey }, "user resolve failed");
    }

    const history = await loadHistory(conversationKey);
    const nudgeDecision = userId
      ? await shouldNudgeGuardadito({ userId, userMessage: body, history })
      : { ok: false, source: null as null };
    const financialContext = userId
      ? await loadSavingsContext(userId)
      : null;

    const result = await processDeps.runAgent({
      history,
      userMessage: body,
      userId,
      senderPhone,
      financialContext,
    });

    await saveHistory(conversationKey, [...history, ...result.newMessages]);

    if (nudgeDecision.ok && userId && nudgeDecision.source) {
      try {
        await recordGuardaditoNudge({
          userId,
          source: nudgeDecision.source,
          amountMicroUsdc: 0n,
          message: result.reply,
        });
      } catch (nudgeErr) {
        log.error({ err: nudgeErr }, "nudge log failed");
      }
    }

    log.info(
      {
        sender: senderLogKey,
        userId: userId ?? "unregistered",
        latencyMs: Date.now() - start,
        len: result.reply.length,
        newMessageCount: result.newMessages.length,
      },
      "agent processed",
    );

    return c.json({ reply: result.reply });
  } catch (err) {
    log.error({ err, sender: senderLogKey }, "agent error");
    return c.json({ error: "agent failed" }, 500);
  }
});

const port = Number(process.env.PORT ?? 3003);
export default { port, fetch: app.fetch };
export { app };

function redactPhoneForLog(phone: string): string {
  if (phone.length <= 5) return "<redacted>";
  return `${phone.slice(0, 3)}…${phone.slice(-2)}`;
}
