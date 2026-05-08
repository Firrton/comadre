/**
 * kycRefreshJob — daily at 04:00 UTC
 *
 * Queries kyc_sessions with status='pending' older than 24 hours.
 * STUBS a Sumsub status check — marks sessions as stale in the DB
 * until the real Sumsub polling is wired up.
 */

import { and, eq, lte, sql } from "drizzle-orm";
import { db, kycSessions } from "@comadre/db";
import { logger } from "../lib/logger.js";

const log = logger.child({ job: "kycRefreshJob" });

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function kycRefreshJob(): Promise<void> {
  const staleBeforeTs = new Date(Date.now() - STALE_THRESHOLD_MS);

  const staleSessions = await db
    .select({
      id: kycSessions.id,
      userWallet: kycSessions.userWallet,
      applicantId: kycSessions.applicantId,
      createdAt: kycSessions.createdAt,
    })
    .from(kycSessions)
    .where(
      and(
        eq(kycSessions.status, "pending"),
        lte(kycSessions.createdAt, staleBeforeTs)
      )
    );

  log.info({ count: staleSessions.length }, "stale pending KYC sessions found");

  for (const session of staleSessions) {
    log.info(
      {
        sessionId: session.id,
        userWallet: session.userWallet,
        applicantId: session.applicantId,
        ageMs: Date.now() - (session.createdAt?.getTime() ?? 0),
      },
      "[stub] would check Sumsub applicant status — marking on_hold"
    );

    // STUB: in production call Sumsub GET /resources/applicants/{applicantId}/status
    // For now mark as on_hold so the session doesn't perpetually block the user
    await db
      .update(kycSessions)
      .set({
        status: "on_hold",
        updatedAt: sql`now()`,
      })
      .where(eq(kycSessions.id, session.id));

    log.info({ sessionId: session.id }, "session marked on_hold");
  }
}
