import { PublicKey } from "@solana/web3.js";
import { env } from "@comadre/config";

/**
 * The deployed Comadre program ID.
 * Source-of-truth: env.COMADRE_PROGRAM_ID
 *
 * Devnet (current deployment): BfVXncFhJdSsDciLx7UzVjFbEBw1EtcnJCsYSRis54Sh
 */
export const COMADRE_PROGRAM_ID: PublicKey = new PublicKey(env.COMADRE_PROGRAM_ID);

/**
 * USDC SPL mint per cluster.
 * Devnet:  4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU (faucet token)
 * Mainnet: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
 */
export const USDC_MINT_DEVNET: PublicKey = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
export const USDC_MINT_MAINNET: PublicKey = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

/** Pick the right USDC mint based on env.SOLANA_CLUSTER. */
export function getUsdcMint(): PublicKey {
  return env.SOLANA_CLUSTER === "mainnet-beta" ? USDC_MINT_MAINNET : USDC_MINT_DEVNET;
}
