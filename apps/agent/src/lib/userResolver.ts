/**
 * Resolve a Twilio "From" identifier to a registered user's Solana wallet.
 *
 * Returns null if the user has not been onboarded yet — the agent must
 * then either ask for consent or call iniciar_onboarding (depending on
 * the system prompt's flow).
 */
import { hashPhone } from "@comadre/cache";
import { db, users } from "@comadre/db";
import { eq } from "drizzle-orm";

import { normalizePhoneE164 } from "./phoneNormalize.js";

export interface ResolvedUser {
  wallet: string;
  phoneE164: string;
  phoneHash: string;
}

export async function resolveUserFromTwilio(
  twilioFrom: string,
): Promise<ResolvedUser | null> {
  const phoneRaw = twilioFrom.replace(/^whatsapp:/, "").trim();
  if (!phoneRaw.startsWith("+")) return null;

  const phoneE164 = normalizePhoneE164(phoneRaw);
  const phoneHash = await hashPhone(phoneE164);

  const rows = await db
    .select({ wallet: users.wallet })
    .from(users)
    .where(eq(users.phoneHash, phoneHash))
    .limit(1);

  const wallet = rows[0]?.wallet;
  if (!wallet) return null;

  return { wallet, phoneE164, phoneHash };
}
