/**
 * Resolve a channel "from" address to a registered user's id (users.id).
 *
 * The `from` parameter is the canonical `whatsapp:+E164` address forwarded
 * by the inbound route (apps/whatsapp → apps/agent POST /process). It may
 * carry any `<channel>:` prefix — the prefix is stripped before DB lookup.
 *
 * Returns null if the user has not been onboarded yet — the agent must
 * then either ask for consent or run the onboarding flow (depending on
 * the system prompt's flow).
 */
import { hashPhone } from "@comadre/cache";
import { db, users } from "@comadre/db";
import { eq } from "drizzle-orm";

import { normalizePhoneE164 } from "./phoneNormalize.js";

export interface ResolvedUser {
  userId: string;
  phoneE164: string;
  phoneHash: string;
}

export async function resolveUserFromPhone(
  from: string,
): Promise<ResolvedUser | null> {
  const phoneRaw = from.replace(/^whatsapp:/, "").trim();
  if (!phoneRaw.startsWith("+")) return null;

  const phoneE164 = normalizePhoneE164(phoneRaw);
  const phoneHash = await hashPhone(phoneE164);

  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.phoneHash, phoneHash))
    .limit(1);

  const userId = rows[0]?.id;
  if (!userId) return null;

  return { userId, phoneE164, phoneHash };
}
