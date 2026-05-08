import { Hono } from "hono";
import { logger } from "hono/logger";

const app = new Hono();
app.use("*", logger());

app.get("/health", (c) => c.json({ ok: true, service: "indexer" }));

// TODO: POST /webhook (Helius enhanced webhook → parse Anchor logs → upsert DB)
// TODO: POST /reindex (admin: reindex desde slot N)

const port = Number(process.env.PORT ?? 3004);
export default { port, fetch: app.fetch };
