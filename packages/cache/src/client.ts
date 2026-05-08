/**
 * Upstash Redis singleton client.
 *
 * LAZY in two stages:
 *   1. Module import  → no work done.
 *   2. `getRedis()` access → client object returned immediately;
 *      still no network call.
 *   3. First Redis method (get, set, exists, …) → reads env vars, throws if
 *      missing, then issues the HTTP request.
 *
 * This means importing this file — and even calling `getRedis()` — is safe
 * in test environments with no UPSTASH_* env vars set. The process only
 * fails if you actually await a Redis operation.
 *
 * Under the hood `@upstash/redis` is REST-based (HTTP, not TCP). No persistent
 * connection is held; each operation is an independent HTTP request.
 *
 * Why process.env directly instead of `@comadre/config`?
 * ──────────────────────────────────────────────────────
 * `@comadre/config` validates ALL environment variables (Solana, Privy,
 * Meta, etc.) at call time. Using it here would fail in any context that
 * only has the Redis credentials available. In production, `@comadre/config`
 * is validated at app startup by the service entry points.
 */
import { Redis } from "@upstash/redis";

/** Resolves and caches the real Redis instance on first method invocation. */
function makeRedisProxy(): Redis {
  let _real: Redis | undefined;

  return new Proxy({} as Redis, {
    get(_target, prop: string | symbol) {
      if (_real === undefined) {
        const url = process.env["UPSTASH_REDIS_REST_URL"];
        const token = process.env["UPSTASH_REDIS_REST_TOKEN"];

        if (!url) {
          throw new Error(
            "[comadre/cache] UPSTASH_REDIS_REST_URL is not set. " +
              "Copy .env.example → .env.local and fill in the value."
          );
        }
        if (!token) {
          throw new Error(
            "[comadre/cache] UPSTASH_REDIS_REST_TOKEN is not set. " +
              "Copy .env.example → .env.local and fill in the value."
          );
        }

        _real = new Redis({ url, token });
      }

      const value = (_real as unknown as Record<string | symbol, unknown>)[prop];
      // Bind methods so `this` inside the Redis SDK refers to the real instance
      return typeof value === "function" ? value.bind(_real) : value;
    },
  });
}

let _redis: Redis | undefined;

/**
 * Returns the shared Redis singleton.
 *
 * Safe to call without env vars present — the client is a lazy proxy that
 * reads `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` from
 * `process.env` only when the first Redis method is invoked.
 *
 * This is the ONLY public entry point for the Redis client. Do not hold
 * references to the returned object across module reloads in tests.
 */
export function getRedis(): Redis {
  if (_redis === undefined) {
    _redis = makeRedisProxy();
  }
  return _redis;
}
