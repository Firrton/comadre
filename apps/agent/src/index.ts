import { Hono } from "hono";
import { logger } from "hono/logger";

const app = new Hono();
app.use("*", logger());

app.get("/health", (c) => c.json({ ok: true, service: "agent" }));

// TODO: POST /process (Claude tool-use loop)

const port = Number(process.env.PORT ?? 3003);
export default { port, fetch: app.fetch };
