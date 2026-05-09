import { PublicKey } from "@solana/web3.js";
import { COMADRE_PROGRAM_ID } from "./programId";
import { SEEDS } from "./seeds";

type PdaResult = readonly [PublicKey, number];

/**
 * Encode a u64 as 8-byte little-endian buffer.
 * Anchor stores `u64` PDA seed components in little-endian (matches `tanda_id.to_le_bytes()`).
 */
function u64Le(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(value);
  return buf;
}

/** Singleton ProgramConfig PDA: `[CONFIG]` */
export function deriveConfigPda(programId: PublicKey = COMADRE_PROGRAM_ID): PdaResult {
  return PublicKey.findProgramAddressSync([SEEDS.CONFIG], programId);
}

/** Per-wallet UserProfile PDA: `[USER, wallet]` */
export function deriveUserProfilePda(wallet: PublicKey, programId: PublicKey = COMADRE_PROGRAM_ID): PdaResult {
  return PublicKey.findProgramAddressSync([SEEDS.USER, wallet.toBuffer()], programId);
}

/** Tanda PDA: `[TANDA, creator, tanda_id_le]` */
export function deriveTandaPda(creator: PublicKey, tandaId: bigint, programId: PublicKey = COMADRE_PROGRAM_ID): PdaResult {
  return PublicKey.findProgramAddressSync([SEEDS.TANDA, creator.toBuffer(), u64Le(tandaId)], programId);
}

/** Member PDA: `[MEMBER, tanda, user]` */
export function deriveMemberPda(tanda: PublicKey, user: PublicKey, programId: PublicKey = COMADRE_PROGRAM_ID): PdaResult {
  return PublicKey.findProgramAddressSync([SEEDS.MEMBER, tanda.toBuffer(), user.toBuffer()], programId);
}

/** Vault token-account PDA: `[VAULT, tanda]` */
export function deriveVaultPda(tanda: PublicKey, programId: PublicKey = COMADRE_PROGRAM_ID): PdaResult {
  return PublicKey.findProgramAddressSync([SEEDS.VAULT, tanda.toBuffer()], programId);
}

/** Dispute PDA: `[DISPUTE, tanda, dispute_id_u8]` */
export function deriveDisputePda(tanda: PublicKey, disputeId: number, programId: PublicKey = COMADRE_PROGRAM_ID): PdaResult {
  if (!Number.isInteger(disputeId) || disputeId < 0 || disputeId > 255) {
    throw new RangeError(`disputeId must be an integer in [0, 255], got ${disputeId}`);
  }
  return PublicKey.findProgramAddressSync([SEEDS.DISPUTE, tanda.toBuffer(), Buffer.from([disputeId])], programId);
}

/** DisputeVote PDA: `[DISPUTE_VOTE, dispute, voter]` */
export function deriveDisputeVotePda(dispute: PublicKey, voter: PublicKey, programId: PublicKey = COMADRE_PROGRAM_ID): PdaResult {
  return PublicKey.findProgramAddressSync([SEEDS.DISPUTE_VOTE, dispute.toBuffer(), voter.toBuffer()], programId);
}

/** Loan PDA: `[LOAN, borrower, loan_id_le]` */
export function deriveLoanPda(borrower: PublicKey, loanId: bigint, programId: PublicKey = COMADRE_PROGRAM_ID): PdaResult {
  return PublicKey.findProgramAddressSync([SEEDS.LOAN, borrower.toBuffer(), u64Le(loanId)], programId);
}

/** Cosigner PDA: `[COSIGNER, loan, cosigner]` */
export function deriveCosignerPda(loan: PublicKey, cosigner: PublicKey, programId: PublicKey = COMADRE_PROGRAM_ID): PdaResult {
  return PublicKey.findProgramAddressSync([SEEDS.COSIGNER, loan.toBuffer(), cosigner.toBuffer()], programId);
}

/** Badge PDA: `[BADGE, user, badge_id_le]` */
export function deriveBadgePda(user: PublicKey, badgeId: bigint, programId: PublicKey = COMADRE_PROGRAM_ID): PdaResult {
  return PublicKey.findProgramAddressSync([SEEDS.BADGE, user.toBuffer(), u64Le(badgeId)], programId);
}
