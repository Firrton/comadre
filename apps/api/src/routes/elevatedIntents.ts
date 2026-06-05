import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db, elevatedIntents, smartWallets } from "@comadre/db";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { otp } from "@comadre/wallet-infra";
import { getLogger } from "../middlewares/logger.js";
import type { AuthUser } from "../middlewares/auth.js";
import { isSameAddress } from "../lib/ownership.js";

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
    const { code } = c.req.valid("json");
    const log = getLogger(c);
    const user = (c.get as (k: string) => unknown)("user") as AuthUser;

    // Look up intent + linked smart wallet to get phone for OTP verify
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
    if (!row || !isSameAddress(row.wallet.userWallet, user.walletAddress)) {
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

    // Verify OTP via Twilio Verify.
    // phoneE164 must be stored in actionPayload at intent creation time.
    const payload = row.intent.actionPayload as Record<string, unknown>;
    const phoneE164 = payload.phoneE164 as string | undefined;
    if (!phoneE164) {
      return c.json({ error: "intent_corrupted", message: "phoneE164 missing from payload" }, 500);
    }

    let checkResult: { approved: boolean; status: string };
    try {
      checkResult = await otp.checkOtp(phoneE164, code);
    } catch (err) {
      log.error({ err }, "[elevated-intent] OTP verify failed");
      return c.json({ error: "otp_verify_failed" }, 502);
    }

    if (!checkResult.approved) {
      return c.json({ error: "invalid_code" }, 401);
    }

    await db
      .update(elevatedIntents)
      .set({ status: "approved", consumedAt: new Date() })
      .where(eq(elevatedIntents.id, intentId));

    // Return ok=true with the actionPayload echoed back.
    // A future Phase 2 worker will pick up approved intents and execute them.
    return c.json({
      ok: true,
      intent_id: intentId,
      action: payload,
    });
  },
);
