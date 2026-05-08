import { Hono } from "hono";
import { logger } from "hono/logger";

const app = new Hono();

app.use("*", logger());

app.get("/health", (c) => c.json({ ok: true, service: "api" }));

// TODO: mount routes from ./routes/*
// TODO: mount middleware (auth, idempotency, rateLimit)
// TODO: mount webhooks

const port = Number(process.env.PORT ?? 3001);

export default { port, fetch: app.fetch };
