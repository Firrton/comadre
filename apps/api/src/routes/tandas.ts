/**
 * /api/v1/tandas — tanda lifecycle endpoints
 *
 * POST /api/v1/tandas              — create tanda (501 — Monad migration pending)
 * GET  /api/v1/tandas              — list user's tandas (paginated)
 * GET  /api/v1/tandas/:id          — single tanda with members
 * POST /api/v1/tandas/:id/join     — join tanda (501 — Monad migration pending)
 * POST /api/v1/tandas/:id/start    — start tanda (501 — Monad migration pending)
 * POST /api/v1/tandas/:id/contribute — contribute (501 — Monad migration pending)
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db, tandas, members } from "@comadre/db";
import { CreateTandaInput, JoinTandaInput, ContributeInput } from "@comadre/types";
import type { AuthUser } from "../middlewares/auth.js";

export const tandasRouter = new Hono();

// ---------------------------------------------------------------------------
// POST /api/v1/tandas — create tanda (Monad migration pending)
// ---------------------------------------------------------------------------
tandasRouter.post(
  "/",
  zValidator("json", CreateTandaInput, (result, c) => {
    if (!result.success) {
      return c.json({ error: "validation", issues: result.error.format() }, 400);
    }
  }),
  (c) =>
    c.json(
      {
        error: "not_implemented",
        message: "Tanda creation via Monad smart contracts is pending migration. Coming soon.",
      },
      501,
    ),
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
  const user = (c.get as (k: string) => unknown)("user") as AuthUser;
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

  // Check if caller is creator or member
  const isCreator = tanda.creatorWallet === user.walletAddress;
  let isMember = false;
  if (!isCreator) {
    const memberCheck = await db
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.tandaId, id), eq(members.userWallet, user.walletAddress)))
      .limit(1);
    isMember = memberCheck.length > 0;
  }

  // Non-members get a redacted view (no member roster)
  if (!isCreator && !isMember) {
    return c.json({ tanda: formatTanda(tanda) }, 200);
  }

  // Members and creator get the full view with roster
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
// POST /api/v1/tandas/:id/join — join tanda (Monad migration pending)
// ---------------------------------------------------------------------------
tandasRouter.post(
  "/:id/join",
  zValidator("json", JoinTandaInput, (result, c) => {
    if (!result.success) {
      return c.json({ error: "validation", issues: result.error.format() }, 400);
    }
  }),
  (c) =>
    c.json(
      {
        error: "not_implemented",
        message: "Joining tandas via Monad smart contracts is pending migration. Coming soon.",
      },
      501,
    ),
);

// ---------------------------------------------------------------------------
// POST /api/v1/tandas/:id/start — start tanda (Monad migration pending)
// ---------------------------------------------------------------------------
tandasRouter.post("/:id/start", (c) =>
  c.json(
    {
      error: "not_implemented",
      message: "Starting tandas via Monad smart contracts is pending migration. Coming soon.",
    },
    501,
  ),
);

// ---------------------------------------------------------------------------
// POST /api/v1/tandas/:id/contribute — contribute (Monad migration pending)
// ---------------------------------------------------------------------------
tandasRouter.post(
  "/:id/contribute",
  zValidator("json", ContributeInput, (result, c) => {
    if (!result.success) {
      return c.json({ error: "validation", issues: result.error.format() }, 400);
    }
  }),
  (c) =>
    c.json(
      {
        error: "not_implemented",
        message: "Contributing to tandas via Monad smart contracts is pending migration. Coming soon.",
      },
      501,
    ),
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
