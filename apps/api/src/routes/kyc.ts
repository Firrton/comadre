/**
 * /api/v1/kyc — KYC session management
 *
 * POST /api/v1/kyc/session — init Sumsub access token (STUB when SUMSUB_APP_TOKEN missing)
 */

import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db, kycSessions } from "@comadre/db";
import { env } from "@comadre/config";
import type { AuthUser } from "../middlewares/auth.js";
import { getLogger } from "../middlewares/logger.js";
import { createApplicant, generateAccessToken } from "../lib/sumsubClient.js";

const LEVEL_NAME = "id-and-liveness";
const TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes

export const kycRouter = new Hono();

kycRouter.post("/session", async (c) => {
  const user = (c.get as (k: string) => unknown)("user") as AuthUser;
  const logger = getLogger(c);

  // Stub path — Sumsub not configured (dev mode)
  if (!env.SUMSUB_APP_TOKEN) {
    logger.warn({ user_id: user.id }, "[kyc] SUMSUB_APP_TOKEN not set, returning stub");

    const sessionRows = await db
      .insert(kycSessions)
      .values({
        userId: user.id,
        levelName: LEVEL_NAME,
        status: "init",
      })
      .returning({ id: kycSessions.id });

    const sessionId = sessionRows[0]?.id ?? "unknown";
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

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

  // Real Sumsub path
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  // Check for an existing active session to reuse
  const existingRows = await db
    .select({ id: kycSessions.id, applicantId: kycSessions.applicantId, status: kycSessions.status })
    .from(kycSessions)
    .where(eq(kycSessions.userId, user.id))
    .limit(10);

  // Only reuse sessions that are still progressing — skip rejected/failed ones
  const activeSession = existingRows.find(
    (r) => r.applicantId !== null && ["init", "pending", "approved"].includes(r.status)
  );

  let sessionId: string;
  let applicantId: string;

  if (activeSession?.applicantId) {
    // Reuse existing applicant — just generate a fresh access token
    sessionId = activeSession.id;
    applicantId = activeSession.applicantId;
    logger.info({ user_id: user.id, applicantId }, "[kyc] reusing existing applicant");
  } else {
    // Create a new applicant + session row
    const created = await createApplicant({
      externalUserId: user.id,
      levelName: LEVEL_NAME,
    });
    applicantId = created.applicantId;

    const inserted = await db
      .insert(kycSessions)
      .values({
        userId: user.id,
        applicantId,
        levelName: LEVEL_NAME,
        status: "pending",
      })
      .returning({ id: kycSessions.id });

    sessionId = inserted[0]?.id ?? "unknown";
    logger.info({ user_id: user.id, applicantId, sessionId }, "[kyc] applicant created");
  }

  const { token, url } = await generateAccessToken({
    externalUserId: user.id,
    levelName: LEVEL_NAME,
  });

  logger.info({ user_id: user.id, sessionId }, "[kyc] access token generated");

  return c.json({ url, session_id: sessionId, expires_at: expiresAt.toISOString() }, 200);
});
