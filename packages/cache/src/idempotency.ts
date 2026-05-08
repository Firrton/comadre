/**
 * Idempotency cache helpers — replay-protection for POST endpoints.
 *
 * Storage key format: `idempotency:{key}`
 * TTL: 24 hours by default.
 *
 * CONTRACT
 * ────────
 * The cache slot type is `CachedResponse = { status: number; body: unknown }`.
 *
 * - `getIdempotent` / `setIdempotent`: low-level access. Callers MUST read and
 *   write the full `{ status, body }` shape.
 * - `withIdempotency<T>`: ergonomic wrapper that auto-wraps the handler result
 *   as `{ status: 200, body: T }` on write and unwraps to `T` on read. Callers
 *   deal only with `T` — the envelope is transparent.
 *
 * RACE-CONDITION BEHAVIOR (documented limitation):
 * ──────────────────────────────────────────────────
 * `withIdempotency` uses a best-effort check-then-set pattern:
 *
 *   1. GET key  → if hit, return cached response immediately.
 *   2. Run handler (the actual business logic).
 *   3. SET key with TTL.
 *
 * There is a window between step 1 and step 3 where two concurrent
 * requests with the same key could BOTH pass the cache check and BOTH
 * run the handler.  Redis SETNX-based locking would prevent this but at
 * the cost of extra round-trips and lock-release complexity.
 *
 * Decision: keep it best-effort.
 * Rationale: the primary guarantee needed here is that a *retried* request
 * (e.g. client retry after a network timeout) gets the cached response
 * rather than triggering a duplicate transaction. True concurrent duplicates
 * within the same millisecond window are extremely rare in practice and the
 * Anchor smart-contract layer provides the ultimate idempotency guarantee
 * via on-chain PDA uniqueness constraints.
 *
 * Callers that need strict serialization MUST implement higher-level
 * locking (e.g. a Postgres advisory lock) before calling `withIdempotency`.
 */
import { getRedis } from "./client.js";

const DEFAULT_TTL_SECONDS = 86_400; // 24 h

export type CachedResponse = { status: number; body: unknown };

const keyFor = (key: string) => `idempotency:${key}`;

/**
 * Retrieve a previously cached response by idempotency key.
 * Returns `null` if the key is not found or has expired.
 *
 * The returned value is always `{ status, body }` — the full `CachedResponse`
 * envelope. If you want only the body, use `withIdempotency<T>` instead.
 */
export async function getIdempotent(key: string): Promise<CachedResponse | null> {
  // Use `unknown` — Upstash auto-deserializes JSON, so the value may already
  // be a parsed object rather than a raw string.
  const raw = await getRedis().get<unknown>(keyFor(key));
  if (raw === null || raw === undefined) return null;

  const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
  return parsed as CachedResponse;
}

/**
 * Store a response under the given idempotency key with a TTL.
 * Overwrites any existing value (safe: same key should produce same response).
 *
 * Callers MUST pass the full `{ status, body }` envelope.
 * Use `withIdempotency<T>` if you want auto-wrapping.
 */
export async function setIdempotent(
  key: string,
  response: CachedResponse,
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): Promise<void> {
  await getRedis().set(keyFor(key), JSON.stringify(response), {
    ex: ttlSeconds,
  });
}

/**
 * Idempotency wrapper — transparent `T` interface over the `CachedResponse` envelope.
 *
 * - Cache miss → run `handler`, store result as `{ status: 200, body: result }`, return `result`.
 * - Cache hit  → return `cached.body as T` without running the handler.
 *
 * The cache slot always stores the full `CachedResponse` shape, keeping
 * `getIdempotent` / `setIdempotent` consistent for direct callers. This
 * function hides the envelope so callers work only with `T`.
 *
 * See module-level docstring for race-condition caveats.
 */
export async function withIdempotency<T>(
  key: string,
  handler: () => Promise<T>,
  opts?: { ttlSeconds?: number }
): Promise<T> {
  const ttl = opts?.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const cached = await getIdempotent(key);

  if (cached !== null) {
    return cached.body as T;
  }

  const result = await handler();

  // Best-effort cache write — do not let a Redis write failure propagate
  // up as a handler error.  The handler already succeeded; the only downside
  // is that the *next* retry won't see the cache and will run again.
  try {
    await setIdempotent(key, { status: 200, body: result as unknown }, ttl);
  } catch (err) {
    console.warn("[cache] idempotency write failed:", err);
  }

  return result;
}
