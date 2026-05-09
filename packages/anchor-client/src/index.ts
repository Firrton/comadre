/**
 * @comadre/anchor-client — typed bindings for the Comadre Anchor program.
 *
 * Exports:
 *   - COMADRE_PROGRAM_ID, USDC_MINT_*, getUsdcMint
 *   - SEEDS, PROGRAM_LIMITS
 *   - PDA derivers (deriveConfigPda, deriveUserProfilePda, deriveTandaPda,
 *     deriveMemberPda, deriveVaultPda, deriveDisputePda, deriveDisputeVotePda,
 *     deriveLoanPda, deriveCosignerPda, deriveBadgePda)
 *   - getComadreProgram (typed Program factory)
 *   - IDL, Comadre (raw IDL + type)
 */
export {
  COMADRE_PROGRAM_ID,
  USDC_MINT_DEVNET,
  USDC_MINT_MAINNET,
  getUsdcMint,
} from "./programId";
export { SEEDS, PROGRAM_LIMITS } from "./seeds";
export {
  deriveConfigPda,
  deriveUserProfilePda,
  deriveTandaPda,
  deriveMemberPda,
  deriveVaultPda,
  deriveDisputePda,
  deriveDisputeVotePda,
  deriveLoanPda,
  deriveCosignerPda,
  deriveBadgePda,
} from "./pdas";
export { getComadreProgram, IDL } from "./program";
export type { Comadre } from "./program";
