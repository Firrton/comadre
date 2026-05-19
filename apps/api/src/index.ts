/**
 * apps/api — entry point
 *
 * Starts the Hono server with Bun.serve.
 * Port: process.env.PORT (Railway) or 3001 (default).
 */

import * as Sentry from "@sentry/bun";
import { env } from "@comadre/config";

import app from "./server.js";

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.NODE_ENV === "production" ? 0.1 : 1.0,
  });
}

const port = Number(process.env["PORT"] ?? 3001);

// Graceful shutdown
process.on("SIGTERM", async () => {
  const { closeDb } = await import("@comadre/db");
  await closeDb();
  process.exit(0);
});

process.on("SIGINT", async () => {
  const { closeDb } = await import("@comadre/db");
  await closeDb();
  process.exit(0);
});

const server = Bun.serve({ port, fetch: app.fetch });

console.log(`[api] listening on http://localhost:${server.port}`);

export default server;
