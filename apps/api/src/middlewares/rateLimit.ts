/**
 * Rate limit middleware.
 *
 * Uses `apiUserRateLimit` from @comadre/cache.
 * Identifier: userId from auth context (falls back to IP for unauthenticated routes).
 * Returns 429 with Retry-After header on limit exceeded.
 *
 * Audit COM-020: money-handling endpoints fail CLOSED on Redis errors (503).
 *   Read-only / non-money endpoints fail open with a warn — losing rate-limit
 *   coverage briefly is better than blocking a `consultar_perfil` lookup.
 *   Money endpoints (transfers, savings withdraws) must NEVER bypass the rate
 *   limit silently — a Redis outage is not a license to drain wallets.
 */

import type { MiddlewareHandler } from "hono";
import { apiUserRateLimit, checkRateLimit } from "@comadre/cache";
import { getLogger } from "./logger.js";
import type { AuthUser } from "./auth.js";

const MONEY_ENDPOINT_PREFIXES = [
  "/api/v1/transfers",
  "/api/v1/transfers-monad",
  "/api/v1/savings",
  "/api/v1/tandas",
  "/api/v1/wallet",
];

function isMoneyEndpoint(path: string): boolean {
  return MONEY_ENDPOINT_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export const rateLimitMiddleware: MiddlewareHandler = async (c, next) => {
  // Skip Redis in test environment to avoid connection timeouts
  if (process.env["SKIP_REDIS"] === "true" || process.env["NODE_ENV"] === "test") {
    return next();
  }

  const logger = getLogger(c);

  const user = (c.get as (k: string) => unknown)("user") as AuthUser | undefined;
  const identifier =
    user?.id ??
    c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ??
    "anonymous";

  let result;
  try {
    result = await checkRateLimit(apiUserRateLimit, identifier);
  } catch (err) {
    if (isMoneyEndpoint(c.req.path)) {
      // Audit COM-020: fail CLOSED on money endpoints.
      logger.error(
        { err, identifier, path: c.req.path },
        "[rateLimit] Redis unavailable on money endpoint — failing closed",
      );
      return c.json(
        { error: "service_unavailable", message: "Rate limiter backend offline" },
        503,
      );
    }
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
