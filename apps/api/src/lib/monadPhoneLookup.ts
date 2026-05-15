/**
 * Phone → Monad smart-wallet resolution.
 *
 * Looks up `smart_wallets` by joining on `users.phoneHash`. Coexists with the
 * Solana `phoneLookup` for the migration window.
 */

import { eq } from "drizzle-orm";
import { db, smartWallets, users } from "@comadre/db";
import { hashPhone } from "@comadre/cache";

export interface MonadPhoneLookupResult {
  phone: string;
  phoneHash: string;
  registered: boolean;
  /** Smart wallet (Kernel) address on Monad — lowercase 0x... */
  smartWalletAddress?: string;
  /** Privy embedded EOA address (owner) — lowercase 0x... */
  ownerAddress?: string;
}

export async function lookupMonadByPhone(e164: string): Promise<MonadPhoneLookupResult> {
  const phoneHash = await hashPhone(e164);

  const rows = await db
    .select({
      smartWalletAddress: smartWallets.smartWalletAddress,
      ownerAddress: smartWallets.ownerAddress,
    })
    .from(users)
    .innerJoin(smartWallets, eq(smartWallets.userWallet, users.wallet))
    .where(eq(users.phoneHash, phoneHash))
    .limit(1);

  const row = rows[0];
  if (!row) return { phone: e164, phoneHash, registered: false };

  return {
    phone: e164,
    phoneHash,
    registered: true,
    smartWalletAddress: row.smartWalletAddress,
    ownerAddress: row.ownerAddress,
  };
}
