/**
 * USDC balance helpers.
 *
 * Reads the user's associated token account for the configured USDC mint and
 * returns atomic micro-USDC units. Missing ATA means zero balance.
 */
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { getConnection } from "./connection";

export interface GetUsdcBalanceParams {
  owner: PublicKey;
  mint: PublicKey;
}

export async function getUsdcBalanceMicro(params: GetUsdcBalanceParams): Promise<bigint> {
  const ata = getAssociatedTokenAddressSync(params.mint, params.owner);
  const connection = getConnection();
  const balance = await connection.getTokenAccountBalance(ata, "confirmed").catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("could not find account") || message.includes("Invalid param")) {
      return null;
    }
    throw err;
  });

  if (balance === null) return 0n;
  return BigInt(balance.value.amount);
}
