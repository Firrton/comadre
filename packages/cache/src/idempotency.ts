/**
 * Idempotency cache helpers — replay-protection for POST endpoints.
 *
 * Storage key format: `idempotency:{key}`
 * TTL: 24 hours by default.
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
 */
export async function getIdempotent(key: string): Promise<CachedResponse | null> {
  const raw = await getRedis().get<string>(keyFor(key));
  if (raw === null || raw === undefined) return null;

  const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
  return parsed as CachedResponse;
}

/**
 * Store a response under the given idempotency key with a TTL.
 * Overwrites any existing value (safe: same key should produce same response).
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
 * Idempotency wrapper.
 *
 * - Cache hit  → return stored response without running the handler.
 * - Cache miss → run handler, cache the result, return it.
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
    // Type assertion: caller is responsible for T being compatible with
    // the cached shape. This is safe because the same endpoint stores
    // and retrieves under the same key.
    return cached as unknown as T;
  }

  const result = await handler();

  // Best-effort cache write — do not let a Redis write failure propagate
  // up as a handler error.  The handler already succeeded; the only downside
  // is that the *next* retry won't see the cache and will run again.
  try {
    await setIdempotent(
      key,
      result as unknown as CachedResponse,
      ttl
    );
  } catch {
    // Non-fatal: log in production but don't throw
  }

  return result;
}
