// ─── Redis client ─────────────────────────────────────────────────────────────
export { redis, getRedis } from "./client.js";

// ─── Idempotency cache ────────────────────────────────────────────────────────
export type { CachedResponse } from "./idempotency.js";
export {
  getIdempotent,
  setIdempotent,
  withIdempotency,
} from "./idempotency.js";

// ─── Rate limiting ────────────────────────────────────────────────────────────
export type { RateLimitConfig, RateLimitResult } from "./rateLimit.js";
export {
  createRateLimiter,
  checkRateLimit,
  apiUserRateLimit,
  agentToolRateLimit,
  webhookRateLimit,
} from "./rateLimit.js";

// ─── WhatsApp 24h window ──────────────────────────────────────────────────────
export {
  hashPhone,
  recordInbound,
  isWithinWindow,
  getWindowExpiry,
} from "./waWindow.js";
