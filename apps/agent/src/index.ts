import { Hono } from "hono";
import { logger } from "hono/logger";
import pino from "pino";
import { z } from "zod";

import { runAgent } from "./agentLoop.js";
import { loadHistory, saveHistory } from "./lib/conversationStore.js";
import { normalizePhoneE164 } from "./lib/phoneNormalize.js";
import { loadSavingsContext } from "./lib/savingsContext.js";
import { resolveUserFromTwilio } from "./lib/userResolver.js";
import { shouldNudgeGuardadito, recordGuardaditoNudge } from "./lib/nudgeGate.js";

const log = pino({ name: "agent" });

const processBodySchema = z.object({
  from: z.string().min(1),
  body: z.string().min(1),
  conversationKey: z.string().min(1),
});

const app = new Hono();
app.use("*", logger());

app.get("/health", (c) => c.json({ ok: true, service: "agent" }));

app.post("/process", async (c) => {
  let parsedBody: unknown;
  try {
    parsedBody = await c.req.json();
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
  const start = Date.now();

  try {
    let userWallet: string | null = null;
    try {
      const resolved = await resolveUserFromTwilio(from);
      userWallet = resolved?.wallet ?? null;
    } catch (resolveErr) {
      log.error({ err: resolveErr, from }, "user resolve failed");
    }

    const history = await loadHistory(conversationKey);
    const nudgeDecision = userWallet
      ? await shouldNudgeGuardadito({ userWallet, userMessage: body, history })
      : { ok: false, source: null as null };
    // Always load savings context when wallet exists, so the LLM can answer
    // questions about APR/Guardadito at any time. The nudge gate only governs
    // whether we PROACTIVELY suggest, not whether the data is available.
    const financialContext = userWallet
      ? await loadSavingsContext(userWallet)
      : null;

    // Extract + normalize phone from "whatsapp:+5218116346072" → "+528116346072"
    const senderPhone = normalizePhoneE164(
      from.replace(/^whatsapp:/, "").trim(),
    );

    const result = await runAgent({
      history,
      userMessage: body,
      userWallet,
      senderPhone,
      financialContext,
    });

    await saveHistory(conversationKey, [...history, ...result.newMessages]);

    if (nudgeDecision.ok && userWallet && nudgeDecision.source) {
      try {
        await recordGuardaditoNudge({
          userWallet,
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
        from,
        userWallet: userWallet ?? "unregistered",
        latencyMs: Date.now() - start,
        len: result.reply.length,
        newMessageCount: result.newMessages.length,
      },
      "agent processed",
    );

    return c.json({ reply: result.reply });
  } catch (err) {
    log.error({ err, from }, "agent error");
    return c.json({ error: "agent failed" }, 500);
  }
});

const port = Number(process.env.PORT ?? 3003);
export default { port, fetch: app.fetch };
export { app };
