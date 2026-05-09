import { AnchorProvider, Program, type Wallet } from "@coral-xyz/anchor";
import type { Connection } from "@solana/web3.js";
import idlJson from "./idl/comadre.json" with { type: "json" };
import type { Comadre } from "./idl/comadre";

/**
 * Build a typed Anchor `Program<Comadre>` from a `Connection` and signing `Wallet`.
 *
 * For backend code where there is NO user wallet (e.g. read-only queries from
 * the indexer or pre-flight checks in apps/api), pass a dummy wallet such as
 * `new NodeWallet(Keypair.generate())` — the Program will still be usable for
 * `.account.<X>.fetch()` and `.methods.<ix>().instruction()` (build-only, no sign).
 */
export function getComadreProgram(connection: Connection, wallet: Wallet): Program<Comadre> {
  const provider = new AnchorProvider(connection, wallet, AnchorProvider.defaultOptions());
  return new Program<Comadre>(idlJson as Comadre, provider);
}

/** Re-export the IDL JSON for callers that need to instantiate without a wallet. */
export const IDL: Comadre = idlJson as Comadre;
export type { Comadre } from "./idl/comadre";
