/**
 * /api/v1/users — user profile endpoints
 *
 * POST /api/v1/users/init    — stub tx-build for init_user_profile
 * POST /api/v1/users/confirm — confirm the authenticated user's profile
 * GET  /api/v1/users/me      — authed user's profile from DB
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
      accounts: { wallet: user.ownerAddress },
    });

    return c.json(stub, 200);
  }
);

// ---------------------------------------------------------------------------
// POST /api/v1/users/confirm — confirm the authenticated user's profile
//
// Identity is now the surrogate UUID (users.id) resolved by the auth
// middleware. The legacy wallet-path squatting check is obsolete: the caller
// can only ever act on their own resolved id. We simply touch the row.
// ---------------------------------------------------------------------------
const ConfirmBody = z.object({ signature: z.string().min(1) });

usersRouter.post(
  "/confirm",
  zValidator("json", ConfirmBody, (result, c) => {
    if (!result.success) {
      return c.json({ error: "validation", issues: result.error.format() }, 400);
    }
  }),
  async (c) => {
    const user = (c.get as (k: string) => unknown)("user") as AuthUser;
    const logger = getLogger(c);

    const updated = await db
      .update(users)
      .set({ updatedAt: new Date() })
      .where(eq(users.id, user.id))
      .returning({ id: users.id });

    if (!updated[0]) {
      return c.json({ error: "not_found", message: "User profile not found" }, 404);
    }

    logger.info({ user_id: user.id }, "user confirmed");
    return c.json({ id: user.id, status: "confirmed" }, 200);
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
    .where(eq(users.id, user.id))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return c.json({ error: "not_found", message: "User profile not found" }, 404);
  }

  return c.json(
    {
      id: row.id,
      owner_address: row.ownerAddress ?? null,
      kyc_tier: row.kycTier,
      country_code: row.countryCode ?? null,
    },
    200
  );
});
