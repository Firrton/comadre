/**
 * Daily aggregate spend cap — audit fix B-2.
 *
 * Counts all in-flight and settled transfers (pending, awaiting_confirmation,
 * confirmed) created in the trailing 24 h window for a given sender, and
 * compares the SUM against the configured cap.
 *
 * Callers MUST insert the candidate row BEFORE calling this function so that
 * the caller's own row is already included in the SUM. This makes the check
 * concurrency-safe: two concurrent transfers that both insert and then both
 * SUM will each see both rows and both be rejected if together they exceed the
 * cap — no race window where both can slip through.
 */

import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db, transfers } from "@comadre/db";

// Cap is read once at module load and cached for the process lifetime.
// The env var is validated by @comadre/config/env.ts to be a non-empty digit string.
const _capStr = process.env["DAILY_AGGREGATE_CAP_USDC"] ?? "100";
const CAP_MICRO_USDC: bigint = BigInt(_capStr) * 1_000_000n;

const TWENTY_FOUR_HOURS_MS = 86_400_000;

/** Statuses that count toward the daily spend cap. */
const IN_FLIGHT_STATUSES = ["pending", "awaiting_confirmation", "confirmed"] as const;

/**
 * Check whether `senderId` has headroom left in their trailing-24h budget.
 *
 * @param senderId  UUID of the sender (users.id)
 * @param dbi       Injectable DB handle for unit tests (default: module-level `db`)
 *
 * Returns `{ ok: true }` when the sender is under the cap (sum ≤ cap).
 * Returns `{ ok: false, spentMicroUsdc, capMicroUsdc }` when the cap is exceeded.
 *
 * Note: "at cap" (sum === cap) is allowed (inclusive boundary).
 */
export async function checkDailyBudget(
  senderId: string,
  dbi: Pick<typeof db, "select"> = db,
): Promise<{ ok: true } | { ok: false; spentMicroUsdc: bigint; capMicroUsdc: bigint }> {
  const since = new Date(Date.now() - TWENTY_FOUR_HOURS_MS);

  const rows = await dbi
    .select({
      total: sql<string>`coalesce(sum(${transfers.amountMicroUsdc}), 0)`,
    })
    .from(transfers)
    .where(
      and(
        eq(transfers.senderId, senderId),
        inArray(transfers.status, [...IN_FLIGHT_STATUSES]),
        gte(transfers.createdAt, since),
      ),
    );

  const spentMicroUsdc = BigInt(rows[0]?.total ?? "0");

  if (spentMicroUsdc > CAP_MICRO_USDC) {
    return { ok: false, spentMicroUsdc, capMicroUsdc: CAP_MICRO_USDC };
  }

  return { ok: true };
}
