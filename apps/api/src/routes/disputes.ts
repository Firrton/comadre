/**
 * /api/v1/disputes — dispute lifecycle endpoints
 *
 * POST /api/v1/tandas/:id/disputes — open dispute (stub tx)
 * POST /api/v1/disputes/:id/vote   — vote on dispute (stub tx)
 * GET  /api/v1/disputes/:id        — dispute detail with vote tallies
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, and } from "drizzle-orm";
import { db, disputes, disputeVotes, members } from "@comadre/db";
import { OpenDisputeInput, VoteDisputeInput } from "@comadre/types";
import { makeTxStub } from "../lib/stubs.js";
import type { AuthUser } from "../middlewares/auth.js";

export const disputesRouter = new Hono();

// ---------------------------------------------------------------------------
// POST /api/v1/tandas/:id/disputes — open a dispute (STUB)
// ---------------------------------------------------------------------------
disputesRouter.post(
  "/tandas/:id/disputes",
  zValidator("json", OpenDisputeInput, (result, c) => {
    if (!result.success) {
      return c.json({ error: "validation", issues: result.error.format() }, 400);
    }
  }),
  async (c) => {
    const tandaId = c.req.param("id");
    const { reason } = c.req.valid("json");
    const user = (c.get as (k: string) => unknown)("user") as AuthUser;
    const idempKey = c.req.header("X-Idempotency-Key") ?? crypto.randomUUID();

    // Pre-flight: caller must be a member
    const memberRows = await db
      .select()
      .from(members)
      .where(and(eq(members.tandaId, tandaId), eq(members.userWallet, user.walletAddress)))
      .limit(1);

    if (!memberRows[0]) {
      return c.json({ error: "forbidden", message: "Caller is not a member of this tanda" }, 403);
    }

    const stub = makeTxStub(idempKey, {
      instruction: "open_dispute",
      args: { tanda_id: tandaId, reason },
      accounts: { opener: user.walletAddress, tanda: tandaId },
    });

    return c.json(stub, 200);
  }
);

// ---------------------------------------------------------------------------
// POST /api/v1/disputes/:id/vote — vote on a dispute (STUB)
// ---------------------------------------------------------------------------
disputesRouter.post(
  "/disputes/:id/vote",
  zValidator("json", VoteDisputeInput, (result, c) => {
    if (!result.success) {
      return c.json({ error: "validation", issues: result.error.format() }, 400);
    }
  }),
  async (c) => {
    const disputeId = c.req.param("id");
    const { continue_tanda } = c.req.valid("json");
    const user = (c.get as (k: string) => unknown)("user") as AuthUser;
    const idempKey = c.req.header("X-Idempotency-Key") ?? crypto.randomUUID();

    // Fetch dispute
    const disputeRows = await db
      .select()
      .from(disputes)
      .where(eq(disputes.id, disputeId))
      .limit(1);

    const dispute = disputeRows[0];
    if (!dispute) {
      return c.json({ error: "not_found", message: `Dispute ${disputeId} not found` }, 404);
    }
    if (dispute.state !== "open") {
      return c.json({ error: "precondition_failed", message: "Dispute is not open" }, 422);
    }

    // Check: caller is a member of the dispute's tanda
    const memberRows = await db
      .select()
      .from(members)
      .where(and(eq(members.tandaId, dispute.tandaId), eq(members.userWallet, user.walletAddress)))
      .limit(1);

    if (!memberRows[0]) {
      return c.json({ error: "forbidden", message: "Caller is not a member of the dispute's tanda" }, 403);
    }

    // No double-vote check
    const existingVote = await db
      .select()
      .from(disputeVotes)
      .where(and(eq(disputeVotes.disputeId, disputeId), eq(disputeVotes.voterWallet, user.walletAddress)))
      .limit(1);

    if (existingVote[0]) {
      return c.json({ error: "precondition_failed", message: "Already voted on this dispute" }, 422);
    }

    const stub = makeTxStub(idempKey, {
      instruction: "vote_dispute",
      args: { dispute_id: disputeId, continue_tanda },
      accounts: { voter: user.walletAddress, dispute: disputeId },
    });

    return c.json(stub, 200);
  }
);

// ---------------------------------------------------------------------------
// GET /api/v1/disputes/:id — dispute detail with vote tallies
// ---------------------------------------------------------------------------
disputesRouter.get("/disputes/:id", async (c) => {
  const disputeId = c.req.param("id");

  const disputeRows = await db
    .select()
    .from(disputes)
    .where(eq(disputes.id, disputeId))
    .limit(1);

  const dispute = disputeRows[0];
  if (!dispute) {
    return c.json({ error: "not_found", message: `Dispute ${disputeId} not found` }, 404);
  }

  const votes = await db
    .select()
    .from(disputeVotes)
    .where(eq(disputeVotes.disputeId, disputeId));

  return c.json(
    {
      id: dispute.id,
      tanda_id: dispute.tandaId,
      opener_wallet: dispute.openerWallet,
      reason_text: dispute.reasonText ?? null,
      state: dispute.state,
      votes_continue: dispute.votesContinue,
      votes_cancel: dispute.votesCancel,
      opened_at: dispute.openedAt?.toISOString() ?? null,
      deadline_ts: dispute.deadlineTs?.toISOString() ?? null,
      votes: votes.map((v) => ({
        voter_wallet: v.voterWallet,
        continue_tanda: v.continueTanda,
        voted_at: v.votedAt?.toISOString() ?? null,
      })),
    },
    200
  );
});
