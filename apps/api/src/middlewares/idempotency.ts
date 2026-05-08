/**
 * Idempotency middleware for POST endpoints.
 *
 * Reads `X-Idempotency-Key` header (required; rejects 400 if missing).
 * Key is scoped as: `api:{userId}:{routePath}:{idempotencyKey}`
 *
 * On cache miss: calls next(), captures JSON response, stores it in Redis.
 * On cache hit: returns cached response immediately without calling next().
 *
 * Redis failures are tolerated (logged, handler executes normally).
 */

import type { MiddlewareHandler } from "hono";
import { getIdempotent, setIdempotent } from "@comadre/cache";
import { getLogger } from "./logger.js";
import type { AuthUser } from "./auth.js";

export const idempotencyMiddleware: MiddlewareHandler = async (c, next) => {
  const logger = getLogger(c);

  const idempKey = c.req.header("X-Idempotency-Key");

  // In test mode without Redis, still enforce key presence but skip cache operations
  const skipRedis = process.env["SKIP_REDIS"] === "true" || process.env["NODE_ENV"] === "test";

  if (!idempKey) {
    return c.json(
      {
        error: "validation",
        message: "X-Idempotency-Key header is required for POST requests",
      },
      400
    );
  }

  const user = (c.get as (k: string) => unknown)("user") as AuthUser | undefined;
  const userId = user?.userId ?? "anon";
  const routeName = c.req.path.replace(/\//g, "_");
  const cacheKey = `api:${userId}:${routeName}:${idempKey}`;

  if (!skipRedis) {
    // Check cache
    try {
      const cached = await getIdempotent(cacheKey);
      if (cached !== null) {
        logger.debug({ cache_key: cacheKey }, "idempotency cache hit");
        return c.json(cached.body, cached.status as 200);
      }
    } catch (err) {
      logger.warn({ err, cache_key: cacheKey }, "[idempotency] Redis read failed, proceeding without cache");
    }
  }

  // Cache miss (or test mode) — execute handler
  await next();

  if (!skipRedis) {
    // Capture response body to store in cache
    try {
      const text = await c.res.clone().text();
      const body: unknown = JSON.parse(text);
      const status = c.res.status;
      await setIdempotent(cacheKey, { status, body });
      logger.debug({ cache_key: cacheKey, status }, "idempotency response cached");
    } catch (err) {
      logger.warn({ err, cache_key: cacheKey }, "[idempotency] Redis write failed, response not cached");
    }
  }
};
