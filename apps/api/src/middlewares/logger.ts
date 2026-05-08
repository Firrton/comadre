/**
 * Request logger middleware — Pino + per-request req_id.
 *
 * Injects a uuid v4 `req_id` on every request, attaches it to the Hono
 * context, and logs a start/end/error line per request.
 */

import pino from "pino";
import type { Context, MiddlewareHandler } from "hono";

// Use Bun's built-in crypto for uuid generation (no extra dep).
function newReqId(): string {
  return crypto.randomUUID();
}

export const rootLogger = pino({
  level: process.env["LOG_LEVEL"] ?? "info",
  base: { service: "api" },
});

/**
 * Hono middleware that:
 * 1. Generates a req_id
 * 2. Attaches `logger` and `req_id` to the context via c.set()
 * 3. Logs the incoming request + outgoing response
 */
export const loggerMiddleware: MiddlewareHandler = async (c, next) => {
  const reqId = newReqId();
  const child = rootLogger.child({ req_id: reqId });

  c.set("logger" as never, child);
  c.set("req_id" as never, reqId);

  const method = c.req.method;
  const path = c.req.path;
  const start = Date.now();

  child.info({ method, path }, "request start");

  try {
    await next();
  } catch (err) {
    child.error({ err, method, path }, "request error");
    throw err;
  }

  const ms = Date.now() - start;
  const status = c.res.status;
  child.info({ method, path, status, ms }, "request end");
};

/** Typed helper so routes can pull a strongly-typed logger. */
export function getLogger(c: Context): pino.Logger {
  return (c.get as (key: string) => unknown)("logger") as pino.Logger ?? rootLogger;
}

export function getReqId(c: Context): string {
  return (c.get as (key: string) => unknown)("req_id") as string ?? "unknown";
}
