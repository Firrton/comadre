/**
 * /api/v1/tandas — tanda lifecycle endpoints
 *
 * POST /api/v1/tandas              — create tanda (on-chain via Anchor)
 * GET  /api/v1/tandas              — list user's tandas (paginated)
 * GET  /api/v1/tandas/:id          — single tanda with members
 * POST /api/v1/tandas/:id/join     — join tanda (stub tx)
 * POST /api/v1/tandas/:id/start    — start tanda (stub tx)
 * POST /api/v1/tandas/:id/contribute — contribute (stub tx)
 */

import { createHash } from "node:crypto";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { db, tandas, members } from "@comadre/db";
import { CreateTandaInput, JoinTandaInput, ContributeInput } from "@comadre/types";
import { buildUnsignedTx, submitWithRetry } from "@comadre/solana";
import { makeTxStub } from "../lib/stubs.js";
import { signWithUserKeypair } from "../lib/userSigner.js";
import { buildCreateTandaIx } from "../lib/buildTandaIx.js";
import type { AuthUser } from "../middlewares/auth.js";

export const tandasRouter = new Hono();

// ---------------------------------------------------------------------------
// POST /api/v1/tandas — create tanda (on-chain)
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

    // Determine next tanda_id: count existing tandas by this creator
    const existingRows = await db
      .select({ id: tandas.id })
      .from(tandas)
      .where(eq(tandas.creatorWallet, user.walletAddress));
    const tandaId = BigInt(existingRows.length);

    const creatorPubkey = new PublicKey(user.walletAddress);

    // Build the create_tanda instruction
    const { instruction, tandaPda, vaultPda } = await buildCreateTandaIx({
      creator: creatorPubkey,
      name: input.name,
      memberTarget: input.member_target,
      contributionAmountAtomic: input.contribution_amount,
      stakeAmountAtomic: input.stake_amount,
      frequencySeconds: input.frequency_seconds,
      payoutOrderMode: input.payout_order_mode,
      tandaId,
    });

    // Build partial-signed tx: fee_payer signs first, creator signs via backend-managed keypair below.
    const built = await buildUnsignedTx({ instructions: [instruction] });
    const tx = VersionedTransaction.deserialize(Buffer.from(built.unsignedTxBase64, "base64"));

    // Custodial sign with the backend-managed user keypair created during onboarding.
    let signedTx: VersionedTransaction;
    try {
      signedTx = await signWithUserKeypair({
        walletAddress: user.walletAddress,
        transaction: tx,
      });
    } catch (err) {
      return c.json(
        { error: "SIGN_FAILED", message: err instanceof Error ? err.message : "Sign failed" },
        502
      );
    }

    // Broadcast with retry + confirmation
    let signature: string;
    try {
      const result = await submitWithRetry(signedTx);
      signature = result.signature;
    } catch (err) {
      return c.json(
        { error: "BROADCAST_FAILED", message: err instanceof Error ? err.message : "Broadcast failed" },
        502
      );
    }

    // Mirror the tanda into the DB so list/get endpoints work pre-indexer
    const usdcMint = process.env["USDC_MINT"] ?? input.usdc_mint;
    const nameHash = createHash("sha256").update(input.name).digest("hex");
    const now = new Date();

    await db.insert(tandas).values({
      id: tandaPda.toBase58(),
      creatorWallet: user.walletAddress,
      tandaId,
      nameHash,
      name: input.name,
      usdcMint,
      vault: vaultPda.toBase58(),
      memberTarget: input.member_target,
      memberCurrent: 0,
      contributionAmount: input.contribution_amount,
      stakeAmount: input.stake_amount,
      frequencySeconds: BigInt(input.frequency_seconds),
      totalTurns: input.member_target,
      currentTurn: 0,
      state: "forming",
      payoutOrderMode: input.payout_order_mode,
      createdAt: now,
      lastSyncedAt: now,
    });

    return c.json(
      {
        tanda_id: tandaPda.toBase58(),
        signature,
        explorer_url: `https://solscan.io/tx/${signature}?cluster=devnet`,
      },
      200
    );
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
