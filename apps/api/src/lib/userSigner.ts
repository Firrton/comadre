import { Keypair, type VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { db, userKeypairs } from "@comadre/db";
import { eq } from "drizzle-orm";

/** Custodial sign: load user's secret from DB, add their signature. */
export async function signWithUserKeypair({
  walletAddress,
  transaction,
}: {
  walletAddress: string;
  transaction: VersionedTransaction;
}): Promise<VersionedTransaction> {
  const rows = await db
    .select({ sk: userKeypairs.secretKeyB58 })
    .from(userKeypairs)
    .where(eq(userKeypairs.wallet, walletAddress))
    .limit(1);

  if (!rows[0]) {
    throw new Error(`USER_KEYPAIR_NOT_FOUND: no signing key in DB for ${walletAddress}`);
  }

  const kp = Keypair.fromSecretKey(bs58.decode(rows[0].sk));
  transaction.sign([kp]);
  return transaction;
}
