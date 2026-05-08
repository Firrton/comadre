/**
 * /api/v1/users — user profile endpoints
 *
 * POST /api/v1/users/init       — stub tx-build for init_user_profile
 * POST /api/v1/users/:wallet/confirm — confirm user after tx + insert into DB
 * GET  /api/v1/users/me          — authed user's profile from DB
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { db, users } from "@comadre/db";
import { CreateUserProfileInput } from "@comadre/types";
import { z } from "zod";
import { makeTxStub } from "../lib/stubs.js";
import type { AuthUser } from "../middlewares/auth.js";
import { getLogger } from "../middlewares/logger.js";

export const usersRouter = new Hono();

// ---------------------------------------------------------------------------
// POST /api/v1/users/init — build init_user_profile tx (STUB)
// ---------------------------------------------------------------------------
usersRouter.post(
  "/init",
  zValidator("json", CreateUserProfileInput, (result, c) => {
    if (!result.success) {
      return c.json({ error: "validation", issues: result.error.format() }, 400);
    }
  }),
  async (c) => {
    const { phone_hash, country_code } = c.req.valid("json");
    const user = (c.get as (k: string) => unknown)("user") as AuthUser;
    const idempKey = c.req.header("X-Idempotency-Key") ?? crypto.randomUUID();

    const stub = makeTxStub(idempKey, {
      instruction: "init_user_profile",
      args: { phone_hash, country_code },
      accounts: { wallet: user.walletAddress },
    });

    return c.json(stub, 200);
  }
);

// ---------------------------------------------------------------------------
// POST /api/v1/users/:wallet/confirm — insert user row (STUB tx-confirm)
// ---------------------------------------------------------------------------
const ConfirmBody = z.object({ signature: z.string().min(1) });

usersRouter.post(
  "/:wallet/confirm",
  zValidator("json", ConfirmBody, (result, c) => {
    if (!result.success) {
      return c.json({ error: "validation", issues: result.error.format() }, 400);
    }
  }),
  async (c) => {
    const wallet = c.req.param("wallet");
    const logger = getLogger(c);

    // Upsert: insert user if not exists, otherwise just return current state.
    await db
      .insert(users)
      .values({
        wallet,
        phoneHash: "",
        countryCode: null,
        kycTier: "t0_demo",
        reputationScore: 0,
        tandasCompleted: 0,
        tandasDefaulted: 0,
        tandasCreated: BigInt(0),
        loansRepaid: 0,
        loansDefaulted: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: users.wallet,
        set: { updatedAt: new Date() },
      });

    logger.info({ wallet }, "user confirmed");
    return c.json({ wallet, status: "confirmed" }, 200);
  }
);

// ---------------------------------------------------------------------------
// GET /api/v1/users/me — authed user profile
// ---------------------------------------------------------------------------
usersRouter.get("/me", async (c) => {
  const user = (c.get as (k: string) => unknown)("user") as AuthUser;

  const rows = await db
    .select()
    .from(users)
    .where(eq(users.wallet, user.walletAddress))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return c.json({ error: "not_found", message: "User profile not found" }, 404);
  }

  return c.json(
    {
      wallet: row.wallet,
      kyc_tier: row.kycTier,
      reputation_score: row.reputationScore,
      tandas_completed: row.tandasCompleted,
      tandas_defaulted: row.tandasDefaulted,
      country_code: row.countryCode ?? null,
    },
    200
  );
});
