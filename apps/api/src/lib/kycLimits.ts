/**
 * KYC tier limits enforcement (Monad version).
 *
 * Hardcoded limits per tier (previously read from on-chain Solana ProgramConfig PDA;
 * that path was removed in the Monad migration). On-chain Monad limits enforcement
 * is a TODO — the smart contract will own this when deployed.
 *
 *   T0Demo:     $10/tx
 *   T1Lite:     $100/tx
 *   T2Standard: $1000/tx
 *   T3Pro:      $10000/tx
 */

const HARDCODED_LIMITS_MICRO_USDC: readonly bigint[] = [
  10n * 1_000_000n,
  100n * 1_000_000n,
  1000n * 1_000_000n,
  10000n * 1_000_000n,
] as const;

export type KycTier = "t0_demo" | "t1_lite" | "t2_standard" | "t3_pro";

const TIER_TO_INDEX: Record<KycTier, number> = {
  t0_demo: 0,
  t1_lite: 1,
  t2_standard: 2,
  t3_pro: 3,
} as const;

export function getKycLimits(): readonly bigint[] {
  return HARDCODED_LIMITS_MICRO_USDC;
}

export class KycLimitExceededError extends Error {
  readonly code = "KYC_LIMIT_EXCEEDED" as const;
  readonly tier: KycTier;
  readonly limitMicroUsdc: bigint;
  readonly limitUsdc: number;

  constructor(tier: KycTier, limitMicroUsdc: bigint) {
    super(`Amount exceeds KYC tier limit for ${tier}`);
    this.tier = tier;
    this.limitMicroUsdc = limitMicroUsdc;
    this.limitUsdc = Number(limitMicroUsdc) / 1_000_000;
  }
}

export function enforceKycLimit(tier: KycTier, amountMicroUsdc: bigint): void {
  const limits = getKycLimits();
  const idx = TIER_TO_INDEX[tier];
  const limit = limits[idx] ?? 0n;
  if (amountMicroUsdc > limit) {
    throw new KycLimitExceededError(tier, limit);
  }
}
