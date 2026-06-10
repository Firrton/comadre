/**
 * apiState.test.ts — unit tests for the three API state helpers.
 *
 * Uses a stubbed RedisLike client passed via the optional `redis` parameter
 * so no network connection is required. Tests run with NODE_ENV != "test"
 * (we set it to "production") so the Redis code path is exercised; the
 * shouldSkipRedis() guard is toggled per test group via env-var manipulation.
 *
 * Pattern: injectable stub (per packages/cache/src/__tests__/cache.smoke.test.ts
 * convention) — avoids mock.module on workspace packages, which leaks across
 * bun test files.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  markNonceSeen,
  putOnboardingHandshake,
  takeOnboardingHandshake,
  putPendingRecipientPhone,
  getPendingRecipientPhone,
  delPendingRecipientPhone,
} from "../apiState.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal in-memory Redis stub that implements the RedisLike surface. */
function makeRedisStub() {
  const store = new Map<string, { value: string; expiresAt: number }>();

  const isAlive = (entry: { value: string; expiresAt: number } | undefined): boolean =>
    entry !== undefined && entry.expiresAt > Date.now();

  const stub = {
    _store: store,
    async set(
      key: string,
      value: string,
      opts: { nx?: true; ex: number } | { ex: number },
    ): Promise<"OK" | null> {
      const existing = store.get(key);
      if ((opts as { nx?: true }).nx && isAlive(existing)) {
        return null; // key already exists → NX rejects
      }
      store.set(key, { value, expiresAt: Date.now() + opts.ex * 1000 });
      return "OK";
    },
    async getdel(key: string): Promise<string | null> {
      const entry = store.get(key);
      if (!isAlive(entry)) {
        store.delete(key);
        return null;
      }
      store.delete(key);
      return entry!.value;
    },
    async get(key: string): Promise<string | null> {
      const entry = store.get(key);
      if (!isAlive(entry)) {
        store.delete(key);
        return null;
      }
      return entry!.value;
    },
    async del(key: string): Promise<number> {
      const had = store.has(key);
      store.delete(key);
      return had ? 1 : 0;
    },
  };

  return stub;
}

/** Redis stub that always throws to simulate a connection error. */
function makeThrowingRedisStub() {
  return {
    async set(): Promise<never> {
      throw new Error("redis connection refused");
    },
    async getdel(): Promise<never> {
      throw new Error("redis connection refused");
    },
    async get(): Promise<never> {
      throw new Error("redis connection refused");
    },
    async del(): Promise<never> {
      throw new Error("redis connection refused");
    },
  };
}

// ─── Environment setup ────────────────────────────────────────────────────────
// Force the Redis code path by removing NODE_ENV=test and SKIP_REDIS.

let _origNodeEnv: string | undefined;
let _origSkipRedis: string | undefined;

beforeEach(() => {
  _origNodeEnv = process.env["NODE_ENV"];
  _origSkipRedis = process.env["SKIP_REDIS"];
  process.env["NODE_ENV"] = "production";
  delete process.env["SKIP_REDIS"];
});

afterEach(() => {
  if (_origNodeEnv === undefined) {
    delete process.env["NODE_ENV"];
  } else {
    process.env["NODE_ENV"] = _origNodeEnv;
  }
  if (_origSkipRedis === undefined) {
    delete process.env["SKIP_REDIS"];
  } else {
    process.env["SKIP_REDIS"] = _origSkipRedis;
  }
});

// ─── markNonceSeen ────────────────────────────────────────────────────────────

describe("markNonceSeen", () => {
  it("returns true for a fresh nonce", async () => {
    const redis = makeRedisStub();
    const result = await markNonceSeen("sig-abc", 90, redis as never);
    expect(result).toBe(true);
  });

  it("returns false for a duplicate nonce within the window", async () => {
    const redis = makeRedisStub();
    await markNonceSeen("sig-dup", 90, redis as never);
    const second = await markNonceSeen("sig-dup", 90, redis as never);
    expect(second).toBe(false);
  });

  it("two distinct nonces are both fresh", async () => {
    const redis = makeRedisStub();
    const a = await markNonceSeen("sig-1", 90, redis as never);
    const b = await markNonceSeen("sig-2", 90, redis as never);
    expect(a).toBe(true);
    expect(b).toBe(true);
  });

  it("falls back to memory and returns true when Redis throws", async () => {
    const redis = makeThrowingRedisStub();
    // Should not throw — fails open to memory
    const result = await markNonceSeen("sig-err-fresh", 90, redis as never);
    expect(result).toBe(true);
  });

  it("uses SKIP_REDIS=true path without touching redis stub", async () => {
    process.env["SKIP_REDIS"] = "true";
    const redis = makeThrowingRedisStub(); // would throw if called
    const result = await markNonceSeen("sig-skip", 90, redis as never);
    expect(result).toBe(true);
  });
});

// ─── putOnboardingHandshake / takeOnboardingHandshake ─────────────────────────

const HANDSHAKE_DATA = {
  subOrgId: "sub-org-123",
  walletId: "wallet-456",
  agentAddress: "0xdeadbeef",
};

describe("onboarding handshake", () => {
  it("take returns the stored payload", async () => {
    const redis = makeRedisStub();
    await putOnboardingHandshake("token-1", HANDSHAKE_DATA, 300, redis as never);
    const result = await takeOnboardingHandshake("token-1", redis as never);
    expect(result).toEqual(HANDSHAKE_DATA);
  });

  it("take deletes the entry (GET+DEL semantics)", async () => {
    const redis = makeRedisStub();
    await putOnboardingHandshake("token-2", HANDSHAKE_DATA, 300, redis as never);
    await takeOnboardingHandshake("token-2", redis as never);
    const second = await takeOnboardingHandshake("token-2", redis as never);
    expect(second).toBeNull();
  });

  it("take returns null for missing token", async () => {
    const redis = makeRedisStub();
    const result = await takeOnboardingHandshake("no-such-token", redis as never);
    expect(result).toBeNull();
  });

  it("put falls back to memory when Redis throws, take succeeds from memory", async () => {
    const redis = makeThrowingRedisStub();
    // put → Redis throws → stored in memory
    await putOnboardingHandshake("token-err", HANDSHAKE_DATA, 300, redis as never);
    // take → Redis throws → falls back to memory
    const result = await takeOnboardingHandshake("token-err", redis as never);
    expect(result).toEqual(HANDSHAKE_DATA);
  });

  it("SKIP_REDIS path uses in-memory store", async () => {
    process.env["SKIP_REDIS"] = "true";
    const redis = makeThrowingRedisStub();
    await putOnboardingHandshake("token-skip", HANDSHAKE_DATA, 300, redis as never);
    const result = await takeOnboardingHandshake("token-skip", redis as never);
    expect(result).toEqual(HANDSHAKE_DATA);
  });
});

// ─── putPendingRecipientPhone / get / del ─────────────────────────────────────

describe("pendingRecipientPhone", () => {
  it("get returns the stored phone", async () => {
    const redis = makeRedisStub();
    await putPendingRecipientPhone("tx-1", "+5491112345678", 900, redis as never);
    const phone = await getPendingRecipientPhone("tx-1", redis as never);
    expect(phone).toBe("+5491112345678");
  });

  it("get does NOT delete the entry (repeated reads return the same value)", async () => {
    const redis = makeRedisStub();
    await putPendingRecipientPhone("tx-2", "+5491112345678", 900, redis as never);
    await getPendingRecipientPhone("tx-2", redis as never);
    const second = await getPendingRecipientPhone("tx-2", redis as never);
    expect(second).toBe("+5491112345678");
  });

  it("del removes the entry", async () => {
    const redis = makeRedisStub();
    await putPendingRecipientPhone("tx-3", "+5491112345678", 900, redis as never);
    await delPendingRecipientPhone("tx-3", redis as never);
    const phone = await getPendingRecipientPhone("tx-3", redis as never);
    expect(phone).toBeNull();
  });

  it("get returns null for missing transferId", async () => {
    const redis = makeRedisStub();
    const phone = await getPendingRecipientPhone("no-such-tx", redis as never);
    expect(phone).toBeNull();
  });

  it("falls back to memory when Redis throws on put+get", async () => {
    const redis = makeThrowingRedisStub();
    await putPendingRecipientPhone("tx-err", "+5491112345678", 900, redis as never);
    const phone = await getPendingRecipientPhone("tx-err", redis as never);
    expect(phone).toBe("+5491112345678");
  });

  it("del with Redis error cleans memory fallback silently", async () => {
    const redis = makeThrowingRedisStub();
    await putPendingRecipientPhone("tx-del-err", "+549999", 900, redis as never);
    // Should not throw even when Redis throws on del
    await expect(delPendingRecipientPhone("tx-del-err", redis as never)).resolves.toBeUndefined();
  });

  it("SKIP_REDIS path uses in-memory store", async () => {
    process.env["SKIP_REDIS"] = "true";
    const redis = makeThrowingRedisStub();
    await putPendingRecipientPhone("tx-skip", "+5491112345678", 900, redis as never);
    const phone = await getPendingRecipientPhone("tx-skip", redis as never);
    expect(phone).toBe("+5491112345678");
  });
});
