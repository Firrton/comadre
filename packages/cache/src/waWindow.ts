/**
 * WhatsApp 24-hour window state helpers.
 *
 * Meta's policy: free-form outbound messages are only allowed within 24 hours
 * of the last inbound message from the user. After the window expires, the
 * service MUST use an approved message template.
 *
 * Storage key: `wa:lastinbound:{phoneHash}`
 *   - `phoneHash` is a SHA-256 hex digest of the E.164 phone number.
 *   - Raw phone numbers are NEVER stored in Redis.
 *   - Callers are responsible for hashing: see `hashPhone()` in this module
 *     for a canonical helper.
 *
 * TTL strategy:
 *   - 24 h + 60 s epsilon to avoid borderline races where the Redis key
 *     expires a few seconds before the 24-hour mark we present to callers.
 *   - Key presence = window is open; key absence = window closed/expired.
 */
import { getRedis } from "./client.js";

const WINDOW_TTL_SECONDS = 86_400; // 24 h
const TTL_EPSILON_SECONDS = 60; // 1-min safety margin
const EFFECTIVE_TTL = WINDOW_TTL_SECONDS + TTL_EPSILON_SECONDS;

const keyFor = (phoneHash: string) => `wa:lastinbound:${phoneHash}`;

/**
 * SHA-256 hash of an E.164 phone number string.
 * Uses the Web Crypto API, which is available in both Bun and modern Node.
 *
 * CONTRACT
 * ────────
 * - Input MUST be an E.164-formatted phone number starting with `+`
 *   (e.g. `"+5491112345678"`).
 * - Leading/trailing whitespace is trimmed before validation.
 * - If the trimmed value does not match `^\+[1-9]\d{6,14}$`, throws with
 *   a descriptive message so mismatches between callers are caught early.
 * - The hash is computed over the trimmed, validated string, guaranteeing
 *   that `"+5491112345678"` and `" +5491112345678 "` produce the same hash.
 *
 * @param e164 - An E.164 phone number string (may have surrounding whitespace).
 * @throws {Error} If the trimmed value is not valid E.164 format.
 */
export async function hashPhone(e164: string): Promise<string> {
  const normalized = e164.trim();
  if (!/^\+[1-9]\d{6,14}$/.test(normalized)) {
    throw new Error(
      `Invalid E.164 phone number: must match ^\\+[1-9]\\d{6,14}$ — got "${normalized}"`
    );
  }
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Record that the user just sent an inbound message.
 * Resets (or creates) the 24-hour window.
 *
 * @param phoneHash - SHA-256 hex of the user's E.164 phone number.
 */
export async function recordInbound(phoneHash: string): Promise<void> {
  const nowMs = Date.now();
  await getRedis().set(keyFor(phoneHash), String(nowMs), {
    ex: EFFECTIVE_TTL,
  });
}

/**
 * Check whether we are still within the 24-hour messaging window.
 *
 * Returns `true` if the user sent an inbound message within the last 24 h
 * (i.e. the Redis key exists and has not expired).
 *
 * @param phoneHash - SHA-256 hex of the user's E.164 phone number.
 */
export async function isWithinWindow(phoneHash: string): Promise<boolean> {
  const exists = await getRedis().exists(keyFor(phoneHash));
  return exists === 1;
}

/**
 * Return the timestamp when the 24-hour window will close, or `null` if
 * the window is already closed (key absent / expired).
 *
 * @param phoneHash - SHA-256 hex of the user's E.164 phone number.
 */
export async function getWindowExpiry(phoneHash: string): Promise<Date | null> {
  const ttl = await getRedis().ttl(keyFor(phoneHash));

  // ttl === -2 → key does not exist
  // ttl === -1 → key exists but has no expiry (should never happen here)
  if (ttl < 0) return null;

  // Subtract the epsilon so we return the *nominal* 24-hour mark, not
  // the extended TTL we use internally.
  const effectiveRemainingSeconds = Math.max(0, ttl - TTL_EPSILON_SECONDS);
  return new Date(Date.now() + effectiveRemainingSeconds * 1000);
}
