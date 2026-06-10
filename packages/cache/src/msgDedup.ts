/**
 * Twilio MessageSid deduplication helper.
 *
 * Twilio may re-deliver webhooks on network retries. To prevent duplicate
 * agent invocations, we mark each inbound MessageSid as seen using a Redis
 * SET NX EX pattern (atomic, no race window).
 *
 * Storage key: `wa:msgsid:{MessageSid}`
 * TTL: 300 seconds (5 minutes) — well above Twilio's retry window.
 *
 * CONTRACT
 * ────────
 * `markMessageSeen(sid)` returns:
 *   - `false` when the SID is NEW     → process the message normally.
 *   - `true`  when the SID is ALREADY seen → this is a duplicate, skip.
 *
 * Callers must handle thrown errors themselves (Redis unavailable, etc.)
 * and choose a fail-open or fail-closed strategy.
 */
import { getRedis } from "./client.js";

const DEDUP_TTL_SECONDS = 300; // 5 minutes

const keyFor = (sid: string) => `wa:msgsid:${sid}`;

/**
 * Atomically mark a Twilio MessageSid as seen.
 *
 * Uses `SET key 1 NX EX {ttl}` — sets the key only if it does NOT exist.
 * Returns:
 *   - `false` if the key was newly created (message is NOT a duplicate).
 *   - `true`  if the key already existed (message IS a duplicate).
 *
 * @param sid - Twilio MessageSid (e.g. "SMxxx...")
 * @throws {Error} if Redis is unavailable (caller decides fail-open/-closed).
 */
export async function markMessageSeen(sid: string): Promise<boolean> {
  const result = await getRedis().set(keyFor(sid), "1", {
    nx: true,
    ex: DEDUP_TTL_SECONDS,
  });
  // SET NX returns "OK" when inserted, null when the key already existed.
  return result === null;
}
