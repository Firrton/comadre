/**
 * /api/v1/tandas — tanda lifecycle endpoints
 *
 * POST /api/v1/tandas              — create (stub tx)
 * GET  /api/v1/tandas              — list user's tandas (paginated)
 * GET  /api/v1/tandas/:id          — single tanda with members
 * POST /api/v1/tandas/:id/join     — join tanda (stub tx)
 * POST /api/v1/tandas/:id/start    — start tanda (stub tx)
 * POST /api/v1/tandas/:id/contribute — contribute (stub tx)
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db, tandas, members } from "@comadre/db";
import { CreateTandaInput, JoinTandaInput, ContributeInput } from "@comadre/types";
import { makeTxStub } from "../lib/stubs.js";
import type { AuthUser } from "../middlewares/auth.js";

export const tandasRouter = new Hono();

// ---------------------------------------------------------------------------
// POST /api/v1/tandas — create tanda (STUB)
// ---------------------------------------------------------------------------
tandasRouter.post(
  "/",
  zValidator("json", CreateTandaInput, (result, c) => {
    if (!result.success) {
      return c.json({ error: "validation", issues: result.error.format() }, 400);
    }
  }),
  async (c) => {
    const input = c.req.valid("json");
    const user = (c.get as (k: string) => unknown)("user") as AuthUser;
    const idempKey = c.req.header("X-Idempotency-Key") ?? crypto.randomUUID();

    const stub = makeTxStub(idempKey, {
      instruction: "create_tanda",
      args: {
        name: input.name,
        member_target: input.member_target,
        contribution_amount: input.contribution_amount.toString(),
        stake_amount: input.stake_amount.toString(),
        frequency_seconds: input.frequency_seconds,
        payout_order_mode: input.payout_order_mode,
        usdc_mint: input.usdc_mint,
      },
      accounts: { creator: user.walletAddress },
    });

    return c.json(stub, 200);
  }
);

// ---------------------------------------------------------------------------
// GET /api/v1/tandas — list user's tandas (via members join)
// ---------------------------------------------------------------------------
const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

tandasRouter.get("/", async (c) => {
  const user = (c.get as (k: string) => unknown)("user") as AuthUser;

  const queryParsed = ListQuery.safeParse({
    limit: c.req.query("limit"),
    offset: c.req.query("offset"),
  });

  const { limit, offset } = queryParsed.success ? queryParsed.data : { limit: 20, offset: 0 };

  // Find all tanda IDs this user is a member of
  const memberRows = await db
    .select({ tandaId: members.tandaId })
    .from(members)
    .where(eq(members.userWallet, user.walletAddress))
    .limit(limit)
    .offset(offset);

  const tandaIds = memberRows.map((r) => r.tandaId);

  if (tandaIds.length === 0) {
    return c.json({ tandas: [], total: 0 }, 200);
  }

  // Fetch tanda rows — one extra query but avoids a complex lateral join
  const tandaRows = await Promise.all(
    tandaIds.map((id) =>
      db.select().from(tandas).where(eq(tandas.id, id)).limit(1)
    )
  );

  const result = tandaRows.flatMap((rows) => rows).map(formatTanda);
  return c.json({ tandas: result, total: result.length }, 200);
});

// ---------------------------------------------------------------------------
// GET /api/v1/tandas/:id — single tanda with members
// ---------------------------------------------------------------------------
tandasRouter.get("/:id", async (c) => {
  const id = c.req.param("id");

  const tandaRows = await db
    .select()
    .from(tandas)
    .where(eq(tandas.id, id))
    .limit(1);

  const tanda = tandaRows[0];
  if (!tanda) {
    return c.json({ error: "not_found", message: `Tanda ${id} not found` }, 404);
  }

  const memberRows = await db
    .select()
    .from(members)
    .where(eq(members.tandaId, id))
    .orderBy(members.turnNumber);

  return c.json({
    ...formatTanda(tanda),
    members: memberRows.map((m) => ({
      wallet: m.userWallet,
      turn_number: m.turnNumber,
      contributions_made: m.contributionsMade,
      has_received_payout: m.hasReceivedPayout,
      is_active: m.isActive,
    })),
  }, 200);
});

// ---------------------------------------------------------------------------
// POST /api/v1/tandas/:id/join — join tanda (STUB)
// ---------------------------------------------------------------------------
tandasRouter.post(
  "/:id/join",
  zValidator("json", JoinTandaInput, (result, c) => {
    if (!result.success) {
      return c.json({ error: "validation", issues: result.error.format() }, 400);
    }
  }),
  async (c) => {
    const id = c.req.param("id");
    const user = (c.get as (k: string) => unknown)("user") as AuthUser;
    const idempKey = c.req.header("X-Idempotency-Key") ?? crypto.randomUUID();

    // Pre-flight: tanda must exist, be in forming state, and have room
    const tandaRows = await db
      .select()
      .from(tandas)
      .where(eq(tandas.id, id))
      .limit(1);
    const tanda = tandaRows[0];

    if (!tanda) {
      return c.json({ error: "not_found", message: `Tanda ${id} not found` }, 404);
    }
    if (tanda.state !== "forming") {
      return c.json({ error: "precondition_failed", message: "Tanda is not in forming state" }, 422);
    }
    if (tanda.memberCurrent >= tanda.memberTarget) {
      return c.json({ error: "precondition_failed", message: "Tanda is full" }, 422);
    }

    const stub = makeTxStub(idempKey, {
      instruction: "join_tanda",
      args: { tanda_id: id },
      accounts: { member: user.walletAddress, tanda: id },
    });

    return c.json(stub, 200);
  }
);

// ---------------------------------------------------------------------------
// POST /api/v1/tandas/:id/start — start tanda (STUB)
// ---------------------------------------------------------------------------
tandasRouter.post("/:id/start", async (c) => {
  const id = c.req.param("id");
  const user = (c.get as (k: string) => unknown)("user") as AuthUser;
  const idempKey = c.req.header("X-Idempotency-Key") ?? crypto.randomUUID();

  const tandaRows = await db
    .select()
    .from(tandas)
    .where(eq(tandas.id, id))
    .limit(1);
  const tanda = tandaRows[0];

  if (!tanda) {
    return c.json({ error: "not_found", message: `Tanda ${id} not found` }, 404);
  }
  if (tanda.creatorWallet !== user.walletAddress) {
    return c.json({ error: "forbidden", message: "Only the creator can start the tanda" }, 403);
  }
  if (tanda.state !== "forming") {
    return c.json({ error: "precondition_failed", message: "Tanda is not in forming state" }, 422);
  }
  if (tanda.memberCurrent < tanda.memberTarget) {
    return c.json(
      { error: "precondition_failed", message: `Need ${tanda.memberTarget} members, have ${tanda.memberCurrent}` },
      422
    );
  }

  const stub = makeTxStub(idempKey, {
    instruction: "start_tanda",
    args: { tanda_id: id },
    accounts: { creator: user.walletAddress, tanda: id },
  });

  return c.json(stub, 200);
});

// ---------------------------------------------------------------------------
// POST /api/v1/tandas/:id/contribute — contribute (STUB)
// ---------------------------------------------------------------------------
tandasRouter.post(
  "/:id/contribute",
  zValidator("json", ContributeInput, (result, c) => {
    if (!result.success) {
      return c.json({ error: "validation", issues: result.error.format() }, 400);
    }
  }),
  async (c) => {
    const id = c.req.param("id");
    const user = (c.get as (k: string) => unknown)("user") as AuthUser;
    const idempKey = c.req.header("X-Idempotency-Key") ?? crypto.randomUUID();

    // Pre-flight: tanda active, caller is a member
    const tandaRows = await db
      .select()
      .from(tandas)
      .where(eq(tandas.id, id))
      .limit(1);
    const tanda = tandaRows[0];

    if (!tanda) {
      return c.json({ error: "not_found", message: `Tanda ${id} not found` }, 404);
    }
    if (tanda.state !== "active") {
      return c.json({ error: "precondition_failed", message: "Tanda is not active" }, 422);
    }

    const memberRows = await db
      .select()
      .from(members)
      .where(and(eq(members.tandaId, id), eq(members.userWallet, user.walletAddress)))
      .limit(1);

    if (!memberRows[0]) {
      return c.json({ error: "forbidden", message: "Caller is not a member of this tanda" }, 403);
    }

    const member = memberRows[0];
    // Check if contribution already made for current_turn
    if (member.contributionsMade >= (tanda.currentTurn ?? 0)) {
      return c.json({ error: "precondition_failed", message: "Contribution already made for current turn" }, 422);
    }

    const stub = makeTxStub(idempKey, {
      instruction: "contribute",
      args: { tanda_id: id, turn: tanda.currentTurn },
      accounts: { member: user.walletAddress, tanda: id },
    });

    return c.json(stub, 200);
  }
);

// ---------------------------------------------------------------------------
// Helper: format a DB row as a partial TandaResponse (without members)
// ---------------------------------------------------------------------------
function formatTanda(t: typeof tandas.$inferSelect) {
  return {
    id: t.id,
    creator: t.creatorWallet,
    name: t.name ?? "",
    state: t.state,
    member_target: t.memberTarget,
    member_current: t.memberCurrent,
    contribution_amount: t.contributionAmount.toString(),
    stake_amount: t.stakeAmount.toString(),
    current_turn: t.currentTurn,
    total_turns: t.totalTurns,
    next_payout_ts: t.nextPayoutTs ? Math.floor(t.nextPayoutTs.getTime() / 1000) : null,
  };
}
