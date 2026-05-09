/**
 * Resolve a Twilio "From" identifier to a registered user's Solana wallet.
 *
 * Used by `runAgent` to populate the `ToolContext` for tool execution.
 * Returns `null` if the user has not been onboarded yet — the agent must
 * then refuse all tool_calls with a friendly "register first" message.
 */
import { hashPhone } from "@comadre/cache";
import { db, users } from "@comadre/db";
import { eq } from "drizzle-orm";

export interface ResolvedUser {
  wallet: string;
  phoneE164: string;
  phoneHash: string;
}

/**
 * Strips Twilio prefix and resolves phone → wallet via the `users` table.
 *
 * @param twilioFrom e.g. "whatsapp:+5218116346072"
 * @returns the user's wallet + phone metadata, or null if unregistered
 */
export async function resolveUserFromTwilio(
  twilioFrom: string,
): Promise<ResolvedUser | null> {
  const phoneE164 = twilioFrom.replace(/^whatsapp:/, "").trim();
  if (!phoneE164.startsWith("+")) return null;

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
