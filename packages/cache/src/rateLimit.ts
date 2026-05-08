/**
 * Rate limit helpers built on `@upstash/ratelimit` (sliding window).
 *
 * Pre-configured limiters:
 *   - apiUserRateLimit    — 100 req / 1 min  (general API, per user)
 *   - agentToolRateLimit  — 30 tool calls / 1 h  (Claude tool-use loop)
 *   - webhookRateLimit    — 60 req / 1 min   (Meta WhatsApp, per phone)
 */
import { Ratelimit } from "@upstash/ratelimit";
import { getRedis } from "./client.js";

export type RateLimitConfig = {
  /** Maximum requests allowed within the window. */
  requests: number;
  /**
   * Duration string accepted by @upstash/ratelimit.
   * Examples: "1 m", "1 h", "30 s".
   */
  window: `${number} ${"s" | "m" | "h" | "d"}`;
};

/**
 * Creates a sliding-window `Ratelimit` instance backed by the shared Redis
 * client.  The `prefix` is prepended to every key stored in Redis so that
 * limiters from different domains don't collide.
 */
export function createRateLimiter(
  prefix: string,
  config: RateLimitConfig
): Ratelimit {
  return new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(config.requests, config.window),
    prefix,
    analytics: false,
  });
}

// ─── Pre-configured limiters ─────────────────────────────────────────────────

/**
 * General REST API — per authenticated user.
 * 100 requests per minute.
 */
export const apiUserRateLimit = createRateLimiter("api:user", {
  requests: 100,
  window: "1 m",
});

/**
 * Claude agent tool-use loop — per user.
 * 30 tool calls per hour (mirrors CHECKLIST.md / apps/agent requirements).
 */
export const agentToolRateLimit = createRateLimiter("agent:tool", {
  requests: 30,
  window: "1 h",
});

/**
 * Meta WhatsApp inbound webhook — per phone number.
 * 60 messages per minute (well above normal usage, guards against spam).
 */
export const webhookRateLimit = createRateLimiter("webhook:phone", {
  requests: 60,
  window: "1 m",
});

// ─── Wrapper helper ───────────────────────────────────────────────────────────

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
};

/**
 * Check a rate limit for the given `identifier` (e.g. userId or phone hash).
 *
 * Returns a normalized result regardless of whether the request is allowed
 * or denied — callers are responsible for returning a 429 when `allowed` is
 * false.
 */
export async function checkRateLimit(
  limiter: Ratelimit,
  identifier: string
): Promise<RateLimitResult> {
  const result = await limiter.limit(identifier);

  return {
    allowed: result.success,
    remaining: result.remaining,
    // `reset` is a Unix timestamp in milliseconds
    resetAt: new Date(result.reset),
  };
}
