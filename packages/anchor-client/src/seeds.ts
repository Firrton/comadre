/**
 * PDA seed constants — must match `packages/anchor-program/src/constants.rs` byte-for-byte.
 * Wrong seeds = wrong PDA derivation = silent breakage.
 */
export const SEEDS = {
  USER: Buffer.from("user"),
  TANDA: Buffer.from("tanda"),
  MEMBER: Buffer.from("member"),
  VAULT: Buffer.from("vault"),
  DISPUTE: Buffer.from("dispute"),
  /** Used by `vote_dispute` to make every member's vote unique per dispute. */
  DISPUTE_VOTE: Buffer.from("dispute_vote"),
  LOAN: Buffer.from("loan"),
  COSIGNER: Buffer.from("cosigner"),
  BADGE: Buffer.from("badge"),
  CONFIG: Buffer.from("config"),
} as const;

/** Aliases for non-PDA constants exposed to clients. */
export const PROGRAM_LIMITS = {
  MAX_MEMBERS: 20,
  MAX_NAME_LEN: 32,
  MAX_DISPUTES_PER_TANDA: 5,
  DISPUTE_VOTING_WINDOW_SECONDS: 7 * 24 * 60 * 60,
  SLASH_GRACE_SECONDS: 86_400,
} as const;
