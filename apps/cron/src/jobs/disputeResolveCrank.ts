/**
 * disputeResolveCrank — every hour
 *
 * Queries disputes that are open and past their deadline,
 * then STUBS the resolve_dispute tx-build.
 *
 * Tx-build is a stub pending anchor-client deploy.
 */

import { and, eq, lt } from "drizzle-orm";
import { db, disputes } from "@comadre/db";
import { logger } from "../lib/logger.js";
import { makeTxStub } from "../lib/txStub.js";

const log = logger.child({ job: "disputeResolveCrank" });

export async function disputeResolveCrank(): Promise<void> {
  const now = new Date();

  const expiredDisputes = await db
    .select({
      id: disputes.id,
      tandaId: disputes.tandaId,
      disputeId: disputes.disputeId,
      votesContinue: disputes.votesContinue,
      votesCancel: disputes.votesCancel,
      deadlineTs: disputes.deadlineTs,
    })
    .from(disputes)
    .where(
      and(
        eq(disputes.state, "open"),
        lt(disputes.deadlineTs, now)
      )
    );

  log.info({ count: expiredDisputes.length }, "expired disputes found");

  for (const dispute of expiredDisputes) {
    const outcome =
      dispute.votesContinue > dispute.votesCancel ? "continue" : "cancel";

    log.info(
      {
        disputeId: dispute.id,
        tandaId: dispute.tandaId,
        outcome,
        votesContinue: dispute.votesContinue,
        votesCancel: dispute.votesCancel,
      },
      "processing expired dispute"
    );

    // STUB: resolve_dispute instruction — replace with anchor-client call on deploy
    makeTxStub(`resolve_dispute:${dispute.id}`, {
      instruction: "resolve_dispute",
      args: {
        dispute_id: String(dispute.disputeId),
        tanda_id: dispute.tandaId,
        outcome,
      },
    });

    log.info({ disputeId: dispute.id }, "resolve_dispute stub emitted");
  }
}
