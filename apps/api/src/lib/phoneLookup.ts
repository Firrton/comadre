/**
 * Phone → wallet resolution.
 *
 * Order of resolution:
 *  1. Hash the input E.164 phone (SHA-256 hex via @comadre/cache).
 *  2. Query `users` table by `phone_hash`. If found → return registered=true.
 *  3. Privy fallback: `privy.getUserByPhoneNumber(phone)`. If user exists in
 *     Privy but no `users` row, we report registered=true with their wallet
 *     (they auth'd at some point); a background task can later sync the row
 *     and call `init_user_profile` on-chain.
 *  4. Else → registered=false.
 *
 * Returned `phoneHash` matches `users.phone_hash` (SHA-256 of E.164).
 */

import { eq } from "drizzle-orm";
import { PrivyClient } from "@privy-io/server-auth";
import { db, users } from "@comadre/db";
import { hashPhone } from "@comadre/cache";
import { rootLogger } from "../middlewares/logger.js";

export interface PhoneLookupResult {
  phone: string;
  phoneHash: string;
  registered: boolean;
  wallet?: string;
  walletPreview?: string;
  kycTier?: "t0_demo" | "t1_lite" | "t2_standard" | "t3_pro";
}

let _privy: PrivyClient | null = null;

function getPrivy(): PrivyClient {
  if (_privy !== null) return _privy;
  const appId = process.env["PRIVY_APP_ID"];
  const appSecret = process.env["PRIVY_APP_SECRET"];
  if (!appId || !appSecret) {
    throw new Error("[phone-lookup] PRIVY_APP_ID and PRIVY_APP_SECRET are required");
  }
  _privy = new PrivyClient(appId, appSecret);
  return _privy;
}

/** "...J4yX" — last 4 chars of a base58 wallet, prefixed by `...`. */
export function previewWallet(wallet: string): string {
  return wallet.length <= 4 ? wallet : `...${wallet.slice(-4)}`;
}

/**
 * Resolve an E.164 phone number to wallet info.
 *
 * @param e164 phone in E.164 format (e.g. `+5218116346072`)
 */
export async function lookupByPhone(e164: string): Promise<PhoneLookupResult> {
  const phoneHash = await hashPhone(e164);

  // 1. DB primary lookup
  const dbRows = await db.select().from(users).where(eq(users.phoneHash, phoneHash)).limit(1);
  const dbUser = dbRows[0];

  if (dbUser) {
    const wallet = dbUser.ownerAddress ?? "";
    return {
      phone: e164,
      phoneHash,
      registered: true,
      wallet,
      walletPreview: previewWallet(wallet),
      kycTier: dbUser.kycTier,
    };
  }

  // 2. Privy fallback
  try {
    const privyUser = await getPrivy().getUserByPhoneNumber(e164);
    // Find an embedded Solana wallet on the Privy user
    const linkedAccounts = (privyUser as unknown as { linkedAccounts?: Array<{ type?: string; chainType?: string; address?: string }> })?.linkedAccounts ?? [];
    const solanaAccount = linkedAccounts.find(
      (a) =>
        a.type === "wallet" &&
        (a.chainType === "solana" || a.chainType === undefined) &&
        typeof a.address === "string"
    );
    if (solanaAccount?.address) {
      return {
        phone: e164,
        phoneHash,
        registered: true,
        wallet: solanaAccount.address,
        walletPreview: previewWallet(solanaAccount.address),
        // No kyc tier from Privy; default to lowest until on-chain profile is initialized
        kycTier: "t0_demo",
      };
    }
  } catch (err) {
    // Treat all Privy lookup failures uniformly as "not found" to avoid fingerprinting
    // (previously only 404-like errors were swallowed, leaking that Privy is reachable)
    rootLogger.warn({ err, phoneE164: e164 }, "[phoneLookup] privy lookup failed, treating as not registered");
    return { phone: e164, phoneHash, registered: false };
  }

  // 3. Not registered anywhere
  return { phone: e164, phoneHash, registered: false };
}
