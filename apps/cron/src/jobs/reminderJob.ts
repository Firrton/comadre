/**
 * reminderJob — daily at 09:00 UTC
 *
 * Finds members of active tandas whose contribution for current_turn is
 * missing AND whose tanda's next_payout_ts is within the next 24 hours.
 *
 * WhatsApp send is stubbed — will be replaced by HTTP call to apps/whatsapp
 * once that service is merged into main.
 */

import { and, eq, lte, lt } from "drizzle-orm";
import { db, tandas, members, users } from "@comadre/db";
import { isWithinWindow } from "@comadre/cache";
import { logger } from "../lib/logger.js";
import { sendTemplate } from "../lib/whatsappStub.js";

const log = logger.child({ job: "reminderJob" });

export async function reminderJob(): Promise<void> {
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // Find active tandas that are due within 24 hours
  const dueTandas = await db
    .select({
      id: tandas.id,
      currentTurn: tandas.currentTurn,
      nextPayoutTs: tandas.nextPayoutTs,
    })
    .from(tandas)
    .where(
      and(
        eq(tandas.state, "active"),
        lte(tandas.nextPayoutTs, in24h)
      )
    );

  log.info({ count: dueTandas.length }, "tandas due within 24h");

  for (const tanda of dueTandas) {
    // Find members who haven't contributed this turn
    // contributionsMade < currentTurn means they're behind
    const pendingMembers = await db
      .select({
        id: members.id,
        userWallet: members.userWallet,
        contributionsMade: members.contributionsMade,
      })
      .from(members)
      .where(
        and(
          eq(members.tandaId, tanda.id),
          eq(members.isActive, true),
          lt(members.contributionsMade, tanda.currentTurn ?? 0)
        )
      );

    log.info(
      { tandaId: tanda.id, pendingCount: pendingMembers.length },
      "members with pending contribution"
    );

    for (const member of pendingMembers) {
      // Look up phone hash to check WA window (we don't have the raw phone here —
      // phone is hashed at rest, so we pass the hash as a proxy identifier)
      const userRows = await db
        .select({ phoneHash: users.phoneHash })
        .from(users)
        .where(eq(users.wallet, member.userWallet))
        .limit(1);

      const phoneHash = userRows[0]?.phoneHash;
      if (phoneHash === undefined) {
        log.warn({ userWallet: member.userWallet }, "user not found — skipping");
        continue;
      }

      // Check if we're within the 24h WhatsApp service-conversation window
      const inWindow = await isWithinWindow(phoneHash);

      log.info(
        {
          memberId: member.id,
          userWallet: member.userWallet,
          tandaId: tanda.id,
          inWindow,
        },
        "sending reminder"
      );

      // STUB: in production this calls apps/whatsapp POST /reply
      await sendTemplate(
        // We only have the hash, not the E.164; stub logs the wallet instead
        member.userWallet,
        inWindow ? "tanda_recordatorio" : "tanda_recordatorio_template",
        {
          tanda_id: tanda.id,
          turn: String(tanda.currentTurn),
          due_ts: tanda.nextPayoutTs?.toISOString() ?? "",
        }
      );
    }
  }
}
