/**
 * Rate limit middleware.
 *
 * Uses `apiUserRateLimit` from @comadre/cache.
 * Identifier: userId from auth context (falls back to IP for unauthenticated routes).
 * Returns 429 with Retry-After header on limit exceeded.
 */

import type { MiddlewareHandler } from "hono";
import { apiUserRateLimit, checkRateLimit } from "@comadre/cache";
import { getLogger } from "./logger.js";
import type { AuthUser } from "./auth.js";

export const rateLimitMiddleware: MiddlewareHandler = async (c, next) => {
  // Skip Redis in test environment to avoid connection timeouts
  if (process.env["SKIP_REDIS"] === "true" || process.env["NODE_ENV"] === "test") {
    return next();
  }

  const logger = getLogger(c);

  const user = (c.get as (k: string) => unknown)("user") as AuthUser | undefined;
  // Fall back to forwarded IP for unauthenticated paths (health, webhooks)
  const identifier =
    user?.userId ??
    c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ??
    "anonymous";

  let result;
  try {
    result = await checkRateLimit(apiUserRateLimit, identifier);
  } catch (err) {
    // Redis unavailable (e.g. test env or network issue) — allow through with a warn.
    // Never block traffic due to rate-limiter backend failures.
    logger.warn({ err, identifier }, "[rateLimit] Redis unavailable, allowing request through");
    return next();
  }

  if (!result.allowed) {
    const retryAfterSeconds = Math.ceil(
      (result.resetAt.getTime() - Date.now()) / 1000
    );
    logger.warn({ identifier, retry_after: retryAfterSeconds }, "rate limit exceeded");
    c.header("Retry-After", String(retryAfterSeconds));
    return c.json({ error: "rate_limit_exceeded", retry_after: retryAfterSeconds }, 429);
  }

  return next();
};
