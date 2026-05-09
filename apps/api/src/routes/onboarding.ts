/**
 * /api/v1/onboarding — phone-based user onboarding (no Privy JWT yet).
 *
 * POST /api/v1/onboarding/init { phone } → creates Privy user + Solana wallet.
 * No user-level auth required (the user has no identity yet).
 */
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import { onboardPhone } from "../lib/onboarding.js";
import { getLogger } from "../middlewares/logger.js";

export const onboardingRouter = new Hono();

const InitBody = z.object({
  phone: z.string().regex(/^\+\d{6,15}$/, "phone must be E.164"),
});

onboardingRouter.post(
  "/init",
  zValidator("json", InitBody, (result, c) => {
    if (!result.success) {
      return c.json({ error: "validation", issues: result.error.format() }, 400);
    }
  }),
  async (c) => {
    const { phone } = c.req.valid("json");
    const log = getLogger(c);

    try {
      const result = await onboardPhone(phone);
      log.info(
        {
          phone: phone.slice(0, 4) + "..." + phone.slice(-3),
          walletAddress: result.walletAddress,
          alreadyExisted: result.alreadyExisted,
        },
        "user onboarded",
      );

      return c.json(
        {
          walletAddress: result.walletAddress,
          walletId: result.walletId,
          privyUserId: result.privyUserId,
          alreadyExisted: result.alreadyExisted,
        },
        200,
      );
    } catch (err) {
      log.error(
        { err, phone: phone.slice(0, 4) + "..." },
        "onboarding failed",
      );
      return c.json(
        {
          error: "ONBOARDING_FAILED",
          message: err instanceof Error ? err.message : String(err),
        },
        502,
      );
    }
  },
);
