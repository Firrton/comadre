/**
 * @comadre/types — API response schemas
 *
 * These schemas validate/parse data flowing OUT of the API to clients.
 * All monetary amounts are returned as strings (JSON-safe representation of
 * u64 atomic units) to avoid IEEE 754 precision loss; clients parse them
 * with BigInt() or a decimal library.
 */

import { z } from "zod";
import { SolanaPubkey } from "./inputs.js";

/**
 * Reusable validator for u64 amounts serialised as decimal strings.
 * Accepts only non-negative integers; rejects floats, negatives, and
 * anything that could be SQL-injected through an amount field.
 */
const AtomicAmountString = z
  .string()
  .regex(/^[0-9]+$/, "Must be a non-negative integer string");

/**
 * KYC tier mirrors the on-chain KycTier enum (state/user.rs).
 * Ordinal mapping is LOCKED to the on-chain #[repr(u8)] order:
 *   T0Demo=0, T1Lite=1, T2Standard=2, T3Pro=3
 * Snake-case used here per TS convention; the anchor-client codegen
 * produces camelCase variants on its side — mapping is 1:1 by ordinal.
 */
const KycTier = z.enum(["t0_demo", "t1_lite", "t2_standard", "t3_pro"]);
export type KycTier = z.infer<typeof KycTier>;

/**
 * Tanda state mirrors the on-chain TandaState enum (state/tanda.rs).
 * Ordinal mapping is LOCKED to the on-chain order:
 *   Forming=0, Active=1, Paused=2, Completed=3, Cancelled=4
 *
 * "forming"   — accepting members, not yet started
 * "active"    — currently running rounds
 * "paused"    — frozen (e.g. during a dispute; program transitions here)
 * "completed" — all payouts distributed
 * "cancelled" — dissolved early
 *
 * "disputed" and "pending" were removed — not on-chain states.
 * "paused" was added. "complete" corrected to "completed".
 */
const TandaState = z.enum([
  "forming",
  "active",
  "paused",
  "completed",
  "cancelled",
]);
export type TandaState = z.infer<typeof TandaState>;

/**
 * Single tanda member, nested inside TandaResponse.
 */
export const MemberResponse = z.object({
  /** Member's Solana wallet address */
  wallet: SolanaPubkey,
  /** 1-based turn index assigned to this member (on-chain: u8, max 255) */
  turn_number: z.number().int().min(1).max(255),
  /** How many contribution rounds this member has paid (on-chain: u8, max 255) */
  contributions_made: z.number().int().min(0).max(255),
  /** Whether this member has already received their payout */
  has_received_payout: z.boolean(),
  /** False if slashed/removed from the tanda */
  is_active: z.boolean(),
});
export type MemberResponse = z.infer<typeof MemberResponse>;

/**
 * Full tanda object returned by GET /api/v1/tandas/:id
 * and as items in the list endpoint.
 */
export const TandaResponse = z.object({
  /** On-chain tanda account pubkey */
  id: SolanaPubkey,
  /** Wallet that created the tanda */
  creator: SolanaPubkey,
  /** Human-readable display name */
  name: z.string().min(1).max(32),
  state: TandaState,
  /** Target number of members required to start */
  member_target: z.number().int().min(3).max(20),
  /** Current number of members who have joined */
  member_current: z.number().int().min(0),
  /**
   * Per-round contribution amount as a decimal string (micro-USDC).
   * Returned as string to preserve u64 precision across JSON.
   * Validated as a non-negative integer string to prevent injection.
   */
  contribution_amount: AtomicAmountString,
  /** Stake (collateral) per member as a decimal string (micro-USDC) */
  stake_amount: AtomicAmountString,
  /** Which round is currently open (1-based, 0 = not started) */
  current_turn: z.number().int().min(0),
  /** Total number of turns (equals member_target) */
  total_turns: z.number().int().min(0),
  /**
   * Unix timestamp (seconds) of the next scheduled payout.
   * null when the tanda is not yet active or already complete.
   */
  next_payout_ts: z.number().int().nullable(),
  /** Full member list, ordered by turn_number */
  members: z.array(MemberResponse),
});
export type TandaResponse = z.infer<typeof TandaResponse>;

/**
 * Returned by GET /api/v1/users/:wallet
 */
export const UserProfileResponse = z.object({
  wallet: SolanaPubkey,
  kyc_tier: KycTier,
  /**
   * On-chain reputation score (0-1000).
   * Increases on successful tandas, decreases on default/slash.
   */
  reputation_score: z.number().int().min(0).max(1000),
  /** Total tandas completed without default */
  tandas_completed: z.number().int().min(0),
  /** Total tandas where the user was slashed as a defaulter */
  tandas_defaulted: z.number().int().min(0),
  /**
   * ISO 3166-1 alpha-2 country code from KYC provider (uppercase, e.g. "AR", "MX").
   * null if KYC not completed.
   */
  country_code: z
    .string()
    .regex(/^[A-Z]{2}$/, "ISO 3166-1 alpha-2 (uppercase)")
    .nullable(),
});
export type UserProfileResponse = z.infer<typeof UserProfileResponse>;

/**
 * Returned by all transaction-build endpoints:
 *   POST /api/v1/tandas           → create
 *   POST /api/v1/tandas/:id/join  → join
 *   POST /api/v1/tandas/:id/contribute → contribute
 *   POST /api/v1/disputes         → open_dispute
 *   POST /api/v1/disputes/:id/vote → vote
 *
 * Client must deserialize `unsigned_tx` (VersionedTransaction.deserialize),
 * sign with their wallet, then broadcast via Helius or confirm back to the API.
 */
export const UnsignedTransactionResponse = z.object({
  /**
   * Base64-encoded serialized Solana VersionedTransaction.
   * The fee_payer has already signed; the client must add user signature.
   */
  unsigned_tx: z
    .string()
    .regex(/^[A-Za-z0-9+/]+=*$/, "Must be base64"),
  /**
   * Idempotency key echoed back from the request header.
   * Clients must include this when calling /confirm to prevent double-submit.
   */
  idempotency_key: z.string().uuid(),
});
export type UnsignedTransactionResponse = z.infer<
  typeof UnsignedTransactionResponse
>;
