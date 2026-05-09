/**
 * @comadre/types — API input schemas
 *
 * AMOUNT CONVENTION:
 * All monetary amounts (contribution_amount, stake_amount) are stored and
 * transmitted as atomic units (lamports for SOL, micro-USDC for USDC).
 * USDC has 6 decimal places, so 1 USDC = 1_000_000 atomic units.
 * This fits within a u64 (max ~18.4 * 10^18), safe as JS bigint.
 * We use z.coerce.bigint() to accept number or string from JSON bodies
 * and coerce to bigint at the validation boundary, since JSON doesn't
 * natively represent BigInt.
 *
 * PUBKEY CONVENTION:
 * Solana public keys are 32-byte ed25519 points encoded as base58.
 * Valid base58 strings are 32-44 chars using the Bitcoin base58 alphabet
 * (no 0, O, I, l). We validate with regex; full curve-point checks are
 * performed by the Solana SDK at tx-build time.
 */

import { z } from "zod";

/** Base58 Solana public key: 32–44 chars, Bitcoin base58 alphabet */
export const SolanaPubkey = z
  .string()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Invalid Solana public key");

/**
 * Positive atomic-unit amount coerced from number/string to bigint.
 * Upper bound is the u64 max (2^64 - 1) to match the on-chain field type.
 */
const PositiveAtomicAmount = z.coerce
  .bigint()
  .refine((v) => v > 0n, "Amount must be a positive integer")
  .refine((v) => v <= 18_446_744_073_709_551_615n, "Amount exceeds u64 max");

/**
 * POST /api/v1/tandas
 * Creates a new tanda on-chain.
 */
export const CreateTandaInput = z.object({
  /** Display name shown to members (1-32 UTF-8 chars) */
  name: z.string().min(1).max(32),

  /** How many members the tanda targets (3-20) */
  member_target: z.number().int().min(3).max(20),

  /**
   * Periodic contribution amount in micro-USDC (atomic units, u64).
   * Coerced from number or string; must be > 0.
   */
  contribution_amount: PositiveAtomicAmount,

  /**
   * Collateral stake each member locks on join, in micro-USDC (atomic units).
   * Must be > 0.
   */
  stake_amount: PositiveAtomicAmount,

  /**
   * Duration of each contribution period in seconds.
   * Minimum 86400 (24 hours) to prevent impractical tandas.
   */
  frequency_seconds: z.number().int().min(86400),

  /**
   * Strategy used to assign payout turns.
   * Maps to on-chain PayoutOrder enum (ordinal-locked):
   *   JoinOrder=0, CreatorSet=1, Random=2
   * "auction" was removed (not in program); "creator_first" renamed → "creator_set".
   */
  payout_order_mode: z.enum(["join_order", "creator_set", "random"]),

  /** SPL token mint for the stablecoin used (must be a valid Solana pubkey) */
  usdc_mint: SolanaPubkey,
});

export type CreateTandaInput = z.infer<typeof CreateTandaInput>;

/**
 * POST /api/v1/tandas/:id/join
 * Joins an existing tanda. The :id param is the pubkey; body carries no
 * extra data beyond authentication, but we include tanda_id in the body
 * for idempotency-key correlation and double-binding.
 */
export const JoinTandaInput = z.object({
  tanda_id: SolanaPubkey,
});

export type JoinTandaInput = z.infer<typeof JoinTandaInput>;

/**
 * POST /api/v1/tandas/:id/contribute
 * Triggers the contribution instruction for the current turn.
 */
export const ContributeInput = z.object({
  tanda_id: SolanaPubkey,
});

export type ContributeInput = z.infer<typeof ContributeInput>;

/**
 * POST /api/v1/disputes
 * Opens a dispute for a tanda. The reason string is stored hashed on-chain
 * (sha256) but transmitted in full so the API can verify and log it.
 * 280-char limit mirrors social media posts (human-readable dispute reason).
 */
export const OpenDisputeInput = z.object({
  tanda_id: SolanaPubkey,
  /** Plain-text reason; will be sha256-hashed before writing on-chain */
  reason: z.string().min(1).max(280),
});

export type OpenDisputeInput = z.infer<typeof OpenDisputeInput>;

/**
 * POST /api/v1/disputes/:id/vote
 * Casts a governance vote on an open dispute.
 */
export const VoteDisputeInput = z.object({
  dispute_id: SolanaPubkey,
  /** true = continue the tanda, false = dissolve and slash the defaulter */
  continue_tanda: z.boolean(),
});

export type VoteDisputeInput = z.infer<typeof VoteDisputeInput>;

/**
 * POST /api/v1/users/init
 * Initializes a user profile on-chain.
 * phone_hash: SHA-256 hex of E.164 phone number (64 hex chars)
 * country_code: ISO 3166-1 alpha-2 uppercase
 */
export const CreateUserProfileInput = z.object({
  phone_hash: z
    .string()
    .regex(/^[0-9a-f]{64}$/, "Must be a SHA-256 hex digest (64 lowercase hex chars)"),
  country_code: z
    .string()
    .regex(/^[A-Z]{2}$/, "Must be ISO 3166-1 alpha-2 uppercase (e.g. 'AR', 'MX')"),
});

export type CreateUserProfileInput = z.infer<typeof CreateUserProfileInput>;

// ---------------------------------------------------------------------------
// Phone-to-phone USDC transfers
// ---------------------------------------------------------------------------

/**
 * E.164 phone number validator: starts with +, country code (1-9), 6-14 more digits.
 * Used as the wire format between WhatsApp/Twilio and our API.
 */
export const E164Phone = z
  .string()
  .regex(/^\+[1-9]\d{6,14}$/, "Phone must be E.164 (e.g. +5218116346072)");

/**
 * GET /api/v1/transfers/lookup?phone=+5218116346072
 * Resolves a phone to wallet info before initiating a transfer.
 */
export const LookupPhoneInput = z.object({
  phone: E164Phone,
});
export type LookupPhoneInput = z.infer<typeof LookupPhoneInput>;

/**
 * POST /api/v1/transfers
 *
 * `amountUsdc` is a decimal STRING ("10.50") to avoid IEEE-754 issues. The API
 * multiplies by 1_000_000 to obtain micro-USDC (u64) before persisting.
 * Up to 6 decimal places (USDC mint precision); leading sign rejected by regex.
 */
export const CreateTransferInput = z.object({
  toPhone: E164Phone,
  amountUsdc: z
    .string()
    .regex(/^\d+(\.\d{1,6})?$/, "Amount must be a non-negative decimal with ≤6 places (e.g. 10.50)")
    .refine((v) => parseFloat(v) > 0, "Amount must be positive"),
  note: z.string().max(280).optional(),
});
export type CreateTransferInput = z.infer<typeof CreateTransferInput>;
