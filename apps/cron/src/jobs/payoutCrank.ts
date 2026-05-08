/**
 * payoutCrank — every 5 minutes
 *
 * Queries tandas that are active and whose next_payout_ts has passed,
 * then STUBS the payout tx-build.
 *
 * Tx-build is a stub pending anchor-client deploy.
 */

import { and, eq, lte, sql } from "drizzle-orm";
import { db } from "@comadre/db";
import { tandas } from "@comadre/db";
import { logger } from "../lib/logger.js";
import { makeTxStub } from "../lib/txStub.js";

const log = logger.child({ job: "payoutCrank" });

export async function payoutCrank(): Promise<void> {
  const now = new Date();

  const dueTandas = await db
    .select({
      id: tandas.id,
      tandaId: tandas.tandaId,
      currentTurn: tandas.currentTurn,
      memberTarget: tandas.memberTarget,
      nextPayoutTs: tandas.nextPayoutTs,
    })
    .from(tandas)
    .where(
      and(
        eq(tandas.state, "active"),
        lte(tandas.nextPayoutTs, now)
      )
    );

  log.info({ count: dueTandas.length }, "due tandas found");

  for (const tanda of dueTandas) {
    log.info({ tandaId: tanda.id, turn: tanda.currentTurn }, "processing payout");

    // STUB: build payout instruction — replace with anchor-client call on deploy
    makeTxStub(`payout:${tanda.id}:turn${tanda.currentTurn}`, {
      instruction: "payout",
      args: {
        tanda_id: tanda.id,
        current_turn: tanda.currentTurn,
        tanda_on_chain_id: String(tanda.tandaId),
      },
    });

    // Update last-checked timestamp so we don't re-process on next tick
    // while waiting for the indexer to advance the state
    await db
      .update(tandas)
      .set({ lastSyncedAt: sql`now()` })
      .where(eq(tandas.id, tanda.id));

    log.info({ tandaId: tanda.id }, "payout stub emitted, lastSyncedAt updated");
  }
}
