/**
 * /api/v1/kyc — KYC session management
 *
 * POST /api/v1/kyc/session — init Sumsub access token (STUB when SUMSUB_APP_TOKEN missing)
 */

import { Hono } from "hono";
import { db, kycSessions } from "@comadre/db";
import type { AuthUser } from "../middlewares/auth.js";
import { getLogger } from "../middlewares/logger.js";

export const kycRouter = new Hono();

kycRouter.post("/session", async (c) => {
  const user = (c.get as (k: string) => unknown)("user") as AuthUser;
  const logger = getLogger(c);

  const sumsubToken = process.env["SUMSUB_APP_TOKEN"];

  // Stub if Sumsub env vars not present
  if (!sumsubToken) {
    logger.warn({ wallet: user.walletAddress }, "[kyc] SUMSUB_APP_TOKEN not set, returning stub");

    // Insert a stub kyc_session row so we have a record
    const sessionRows = await db
      .insert(kycSessions)
      .values({
        userWallet: user.walletAddress,
        levelName: "basic-kyc-level",
        status: "init",
      })
      .returning({ id: kycSessions.id });

    const sessionId = sessionRows[0]?.id ?? "unknown";
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    return c.json(
      {
        token: "stub-pending-sumsub",
        session_id: sessionId,
        expires_at: expiresAt.toISOString(),
        stub: true,
      },
      200
    );
  }

  // Real Sumsub call would go here.
  // TODO: call Sumsub /resources/accessTokens, store applicantId, return token.
  return c.json({ error: "not_implemented", message: "Sumsub integration pending" }, 501);
});
