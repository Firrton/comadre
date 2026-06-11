import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db, elevatedIntents, smartWallets } from "@comadre/db";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { getLogger } from "../middlewares/logger.js";
import type { AuthUser } from "../middlewares/auth.js";

export const elevatedIntentsRouter = new Hono();

const ConfirmBody = z.object({
  code: z.string().regex(/^\d{4,8}$/, "code must be 4-8 digits"),
});

elevatedIntentsRouter.post(
  "/:id/confirm",
  zValidator("json", ConfirmBody, (result, c) => {
    if (!result.success) return c.json({ error: "validation", issues: result.error.format() }, 400);
  }),
  async (c) => {
    const intentId = c.req.param("id");
    const { code: _code } = c.req.valid("json"); // validated; unused until OTP provider is wired
    const log = getLogger(c);
    const user = (c.get as (k: string) => unknown)("user") as AuthUser;

    // Look up intent + linked smart wallet for ownership check
    const rows = await db
      .select({
        intent: elevatedIntents,
        wallet: smartWallets,
      })
      .from(elevatedIntents)
      .innerJoin(smartWallets, eq(smartWallets.id, elevatedIntents.smartWalletId))
      .where(eq(elevatedIntents.id, intentId))
      .limit(1);

    const row = rows[0];
    // F-2: 404 if the intent doesn't exist OR isn't owned by the authenticated
    // caller. Return 404 (not 403) so we never leak that another user's intent
    // exists. Ownership = caller's wallet matches the intent's smart-wallet owner.
    if (!row || row.wallet.userId !== user.id) {
      return c.json({ error: "not_found" }, 404);
    }

    if (row.intent.status !== "pending") {
      return c.json({ error: "invalid_state", status: row.intent.status }, 409);
    }
    if (row.intent.expiresAt.getTime() < Date.now()) {
      await db
        .update(elevatedIntents)
        .set({ status: "expired" })
        .where(eq(elevatedIntents.id, intentId));
      return c.json({ error: "expired" }, 410);
    }

    // OTP verification deferred — SMS OTP provider removed; replacement provider TBD.
    // Elevated intents are BLOCKED (fail-closed) until a new OTP provider is wired.
    // Tracked as debt: docs/WALLET_SECURITY.md §5 / COM-OTP-DEFER.
    log.warn({ intentId }, "[elevated-intent] OTP verification not available; rejecting (fail-closed)");
    return c.json({ error: "otp_unavailable", message: "OTP verification is not configured" }, 503);
  },
);
