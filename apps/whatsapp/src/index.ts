import { Hono } from "hono";
import { logger } from "hono/logger";

const app = new Hono();
app.use("*", logger());

app.get("/health", (c) => c.json({ ok: true, service: "whatsapp" }));

// TODO: GET /webhook (Meta verification handshake)
// TODO: POST /webhook (signature verify, parse, enqueue, dispatch to agent)
// TODO: POST /reply (internal: send outbound message via Graph API)

const port = Number(process.env.PORT ?? 3002);
export default { port, fetch: app.fetch };
