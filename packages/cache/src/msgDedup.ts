/**
 * WhatsApp message-id deduplication helper.
 *
 * OpenWA may re-deliver webhooks on network retries. To prevent duplicate
 * agent invocations, we mark each inbound message id as seen using a Redis
 * SET NX EX pattern (atomic, no race window).
 *
 * Storage key: `wa:msgid:{messageId}`
 * TTL: 300 seconds (5 minutes) — well above OpenWA's retry window.
 *
 * CONTRACT
 * ────────
 * `markMessageSeen(id)` returns:
 *   - `false` when the id is NEW     → process the message normally.
 *   - `true`  when the id is ALREADY seen → this is a duplicate, skip.
 *
 * Callers must handle thrown errors themselves (Redis unavailable, etc.)
 * and choose a fail-open or fail-closed strategy.
 */
import { getRedis } from "./client.js";

const DEDUP_TTL_SECONDS = 300; // 5 minutes

const keyFor = (id: string) => `wa:msgid:${id}`;

/**
 * Atomically mark a WhatsApp message id as seen.
 *
 * Uses `SET key 1 NX EX {ttl}` — sets the key only if it does NOT exist.
 * Returns:
 *   - `false` if the key was newly created (message is NOT a duplicate).
 *   - `true`  if the key already existed (message IS a duplicate).
 *
 * @param id - OpenWA message id (e.g. "true_5491112345678@c.us_3EB0...")
 * @throws {Error} if Redis is unavailable (caller decides fail-open/-closed).
 */
export async function markMessageSeen(id: string): Promise<boolean> {
  const result = await getRedis().set(keyFor(id), "1", {
    nx: true,
    ex: DEDUP_TTL_SECONDS,
  });
  // SET NX returns "OK" when inserted, null when the key already existed.
  return result === null;
}
