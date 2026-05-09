import { Hono } from "hono";
import { logger } from "hono/logger";
import pino from "pino";
import { z } from "zod";

import { runAgent, type ChatMessage } from "./agentLoop.js";
import { loadHistory, saveHistory } from "./lib/conversationStore.js";

const log = pino({ name: "agent" });

const processBodySchema = z.object({
  from: z.string().min(1),
  body: z.string().min(1),
  conversationKey: z.string().min(1),
});

const app = new Hono();
app.use("*", logger());

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------
app.get("/health", (c) => c.json({ ok: true, service: "agent" }));

// ---------------------------------------------------------------------------
// POST /process — main entrypoint from the WhatsApp service
// ---------------------------------------------------------------------------
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
    const history = await loadHistory(conversationKey);

    const userMessage: ChatMessage = { role: "user", content: body };
    const result = await runAgent([...history, userMessage]);

    // Persist history (trim to last N happens inside saveHistory)
    await saveHistory(conversationKey, [
      ...history,
      userMessage,
      ...result.updatedMessages.slice(-1),
    ]);

    log.info(
      { from, latencyMs: Date.now() - start, len: result.reply.length },
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
