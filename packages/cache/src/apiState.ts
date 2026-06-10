/**
 * API in-process state helpers — Redis-backed with in-memory fallback.
 *
 * Three concerns extracted from module-level Maps in apps/api:
 *
 *   1. Nonce dedup (HMAC replay protection)
 *      Key: `api:nonce:{signature}`  TTL = windowSeconds
 *      SET NX EX — returns true when the nonce is FRESH (not seen), false on replay.
 *
 *   2. Onboarding handshake (sessionAgentMemory)
 *      Key: `api:onboarding:{token}`  TTL = ttlSeconds
 *      putOnboardingHandshake — SET EX
 *      takeOnboardingHandshake — GETDEL (atomic get-and-delete)
 *
 *   3. Pending recipient phones (pendingRecipientPhones)
 *      Key: `api:recipientphone:{transferId}`  TTL = ttlSeconds
 *      putPendingRecipientPhone / getPendingRecipientPhone / delPendingRecipientPhone
 *
 * PII note: the phone value stored in key 3 is plaintext E.164 in Redis with a
 * short TTL. This is consistent with the existing decision that conversation
 * history lives in Redis plaintext; encryption at-rest is a separate known risk
 * documented in docs/SECURITY.md.
 *
 * Fallback strategy (shared by all three helpers):
 *   - When SKIP_REDIS=true or NODE_ENV=test → use only in-memory Maps.
 *   - When Redis throws → log warn, fall back to the in-memory Map.
 *   - The API never goes down because of nonce/handshake storage failures.
 *
 * Injectable redis parameter
 * ──────────────────────────
 * Each helper accepts an optional `redis` parameter so unit tests can pass a
 * stub without reaching the network. When omitted the shared singleton from
 * `getRedis()` is used.
 */
import { getRedis } from "./client.js";

// ─── Shared type for the injectable Redis surface ────────────────────────────

type RedisLike = {
  set(key: string, value: string, opts: { nx: true; ex: number }): Promise<"OK" | null>;
  set(key: string, value: string, opts: { ex: number }): Promise<"OK" | null>;
  getdel(key: string): Promise<string | null>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
};

// ─── Guard: skip Redis in test/CI environment ─────────────────────────────────

function shouldSkipRedis(): boolean {
  return (
    process.env["SKIP_REDIS"] === "true" || process.env["NODE_ENV"] === "test"
  );
}

// ─── 1. Nonce dedup ───────────────────────────────────────────────────────────

/** In-memory fallback store for nonce dedup. */
const _nonceMemory = new Map<string, number>(); // sig → expiresAtMs

const nonceKeyFor = (sig: string) => `api:nonce:${sig}`;

/**
 * Marks a nonce as seen within the given TTL window.
 *
 * Returns `true`  → nonce is FRESH; caller should accept the request.
 * Returns `false` → nonce already seen; caller should reject as replay.
 *
 * Redis path: SET NX EX — atomic; if the key already exists SET NX returns
 * null, meaning the nonce was already recorded → replay.
 *
 * Fallback: in-memory Map with manual TTL tracking (same semantics, not safe
 * across instances — intended only for single-instance test/dev scenarios).
 *
 * @param signature   - The HMAC hex signature to deduplicate.
 * @param windowSeconds - How long to remember the signature (should match
 *                        MAX_SIGNATURE_AGE_MS / 1000 in the caller).
 * @param redis       - Optional injectable Redis stub for unit tests.
 */
export async function markNonceSeen(
  signature: string,
  windowSeconds: number,
  redis?: RedisLike,
): Promise<boolean> {
  if (shouldSkipRedis()) {
    return _nonceMemFresh(signature, windowSeconds);
  }

  const client = (redis ?? getRedis()) as RedisLike;
  try {
    const result = await client.set(nonceKeyFor(signature), "1", {
      nx: true,
      ex: windowSeconds,
    });
    // SET NX returns "OK" when the key was SET (fresh); null when it already existed (replay).
    return result === "OK";
  } catch (err) {
    console.warn("[cache/apiState] markNonceSeen Redis error, falling back to memory:", err);
    return _nonceMemFresh(signature, windowSeconds);
  }
}

function _nonceMemFresh(signature: string, windowSeconds: number): boolean {
  const now = Date.now();
  // Prune expired entries when the map grows large.
  if (_nonceMemory.size >= 1024) {
    for (const [sig, exp] of _nonceMemory) {
      if (exp <= now) _nonceMemory.delete(sig);
    }
  }
  const existing = _nonceMemory.get(signature);
  if (existing !== undefined && existing > now) {
    return false; // replay
  }
  _nonceMemory.set(signature, now + windowSeconds * 1000);
  return true; // fresh
}

// ─── 2. Onboarding handshake ──────────────────────────────────────────────────

export type OnboardingHandshake = {
  subOrgId: string;
  walletId: string;
  agentAddress: string;
};

type HandshakeEntry = OnboardingHandshake & { expiresAt: number };

/** In-memory fallback store for onboarding handshakes. */
const _handshakeMemory = new Map<string, HandshakeEntry>();

const handshakeKeyFor = (token: string) => `api:onboarding:${token}`;

/**
 * Stores an onboarding handshake payload under the given token key with a TTL.
 *
 * Redis path: SET EX (plain overwrite; the token is one-use and bound to the
 * magic-link TTL so collision is not a concern).
 *
 * Fallback on Redis error: store in memory and log a warning. The handshake
 * will then be available locally until the process restarts.
 */
export async function putOnboardingHandshake(
  token: string,
  data: OnboardingHandshake,
  ttlSeconds: number,
  redis?: RedisLike,
): Promise<void> {
  if (shouldSkipRedis()) {
    _handshakeMemPut(token, data, ttlSeconds);
    return;
  }

  const client = (redis ?? getRedis()) as RedisLike;
  try {
    await client.set(handshakeKeyFor(token), JSON.stringify(data), { ex: ttlSeconds });
  } catch (err) {
    console.warn("[cache/apiState] putOnboardingHandshake Redis error, falling back to memory:", err);
    _handshakeMemPut(token, data, ttlSeconds);
  }
}

/**
 * Atomically retrieves and deletes the handshake for the given token.
 *
 * Returns the payload when found and not expired, or `null` when absent /
 * expired.
 *
 * Redis path: GETDEL (single round-trip, no TOCTOU between get and delete).
 *
 * Fallback on Redis error: try the in-memory Map before returning null.
 */
export async function takeOnboardingHandshake(
  token: string,
  redis?: RedisLike,
): Promise<OnboardingHandshake | null> {
  if (shouldSkipRedis()) {
    return _handshakeMemTake(token);
  }

  const client = (redis ?? getRedis()) as RedisLike;
  try {
    const raw = await client.getdel(handshakeKeyFor(token));
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as OnboardingHandshake;
    return parsed;
  } catch (err) {
    console.warn("[cache/apiState] takeOnboardingHandshake Redis error, falling back to memory:", err);
    return _handshakeMemTake(token);
  }
}

function _handshakeMemPut(token: string, data: OnboardingHandshake, ttlSeconds: number): void {
  _handshakeMemory.set(token, { ...data, expiresAt: Date.now() + ttlSeconds * 1000 });
  setTimeout(() => {
    const entry = _handshakeMemory.get(token);
    if (entry && entry.expiresAt <= Date.now()) _handshakeMemory.delete(token);
  }, ttlSeconds * 1000).unref?.();
}

function _handshakeMemTake(token: string): OnboardingHandshake | null {
  const entry = _handshakeMemory.get(token);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    _handshakeMemory.delete(token);
    return null;
  }
  _handshakeMemory.delete(token);
  const { expiresAt: _discarded, ...data } = entry;
  return data;
}

// ─── 3. Pending recipient phones ──────────────────────────────────────────────

type PhoneEntry = { phone: string; expiresAt: number };

/** In-memory fallback store for pending recipient phones. */
const _phoneMemory = new Map<string, PhoneEntry>();

const phoneKeyFor = (transferId: string) => `api:recipientphone:${transferId}`;

/**
 * Stores the E.164 recipient phone for a pending confirmation transfer.
 *
 * PII note: phone is stored plaintext in Redis with a short TTL. See module
 * docstring.
 */
export async function putPendingRecipientPhone(
  transferId: string,
  phone: string,
  ttlSeconds: number,
  redis?: RedisLike,
): Promise<void> {
  if (shouldSkipRedis()) {
    _phoneMemory.set(transferId, { phone, expiresAt: Date.now() + ttlSeconds * 1000 });
    return;
  }

  const client = (redis ?? getRedis()) as RedisLike;
  try {
    await client.set(phoneKeyFor(transferId), phone, { ex: ttlSeconds });
  } catch (err) {
    console.warn("[cache/apiState] putPendingRecipientPhone Redis error, falling back to memory:", err);
    _phoneMemory.set(transferId, { phone, expiresAt: Date.now() + ttlSeconds * 1000 });
  }
}

/**
 * Returns the stored recipient phone for a transfer, or `null` if absent /
 * expired.
 *
 * Does NOT delete the entry — the caller needs the phone for multiple reply
 * messages before the transfer is resolved.
 */
export async function getPendingRecipientPhone(
  transferId: string,
  redis?: RedisLike,
): Promise<string | null> {
  if (shouldSkipRedis()) {
    return _phoneMemGet(transferId);
  }

  const client = (redis ?? getRedis()) as RedisLike;
  try {
    return await client.get(phoneKeyFor(transferId));
  } catch (err) {
    console.warn("[cache/apiState] getPendingRecipientPhone Redis error, falling back to memory:", err);
    return _phoneMemGet(transferId);
  }
}

/**
 * Deletes the recipient phone entry for a resolved (confirmed, cancelled, or
 * failed) transfer.
 */
export async function delPendingRecipientPhone(
  transferId: string,
  redis?: RedisLike,
): Promise<void> {
  if (shouldSkipRedis()) {
    _phoneMemory.delete(transferId);
    return;
  }

  const client = (redis ?? getRedis()) as RedisLike;
  try {
    await client.del(phoneKeyFor(transferId));
  } catch (err) {
    console.warn("[cache/apiState] delPendingRecipientPhone Redis error, falling back to memory:", err);
    _phoneMemory.delete(transferId);
  }
}

function _phoneMemGet(transferId: string): string | null {
  const entry = _phoneMemory.get(transferId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    _phoneMemory.delete(transferId);
    return null;
  }
  return entry.phone;
}
