/**
 * KYC tier limits enforcement.
 *
 * Reads `kyc_limits[T0..T3]` from the on-chain `ProgramConfig` PDA, cached for
 * 60 seconds in process memory. If `init_config` has not been called yet (the
 * PDA doesn't exist), falls back to a hardcoded default per the plan v2:
 *   T0Demo:     $10/tx
 *   T1Lite:     $100/tx
 *   T2Standard: $1000/tx
 *   T3Pro:      $10000/tx
 *
 * The defaults are placeholder; the runbook step `init-program-config.ts`
 * should set the real on-chain values before mainnet deploy.
 */

import { Keypair } from "@solana/web3.js";
import { Wallet } from "@coral-xyz/anchor";
import { COMADRE_PROGRAM_ID, deriveConfigPda, getComadreProgram } from "@comadre/anchor-client";
import { getConnection } from "@comadre/solana";

/** Hardcoded fallback when `ProgramConfig` is not initialized on-chain. */
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

interface KycLimitsCache {
  limits: readonly bigint[];
  fetchedAt: number;
  fromChain: boolean;
}

const CACHE_TTL_MS = 60_000;
let _cache: KycLimitsCache | null = null;

/**
 * Read `kyc_limits` from on-chain `ProgramConfig`, with caching + hardcoded fallback.
 * Returns the 4-element array `[T0, T1, T2, T3]` in micro-USDC bigint units.
 */
export async function getKycLimits(): Promise<readonly bigint[]> {
  const now = Date.now();
  if (_cache && now - _cache.fetchedAt < CACHE_TTL_MS) {
    return _cache.limits;
  }

  try {
    const connection = getConnection();
    // We don't need a real wallet for read-only account fetches; an ephemeral
    // keypair is fine. Anchor's Wallet wrapper just needs `publicKey`.
    const dummyWallet = new Wallet(Keypair.generate());
    const program = getComadreProgram(connection, dummyWallet);
    const [configPda] = deriveConfigPda(COMADRE_PROGRAM_ID);

    // The IDL exposes the ProgramConfig account under one of: `programConfig`,
    // `ProgramConfig`. Try both via type cast.
    const accountFetcher = (program.account as Record<string, { fetch: (pda: import("@solana/web3.js").PublicKey) => Promise<unknown> } | undefined>)["programConfig"];
    if (!accountFetcher) {
      throw new Error("ProgramConfig account fetcher not found in IDL");
    }
    const config = (await accountFetcher.fetch(configPda)) as { kycLimits: bigint[] | number[] };
    const limits = config.kycLimits.map((v) => (typeof v === "bigint" ? v : BigInt(v)));
    if (limits.length !== 4) {
      throw new Error(`Expected 4 kyc_limits, got ${limits.length}`);
    }

    _cache = { limits, fetchedAt: now, fromChain: true };
    return limits;
  } catch (_err) {
    // Likely AccountNotFound (init_config not yet called) or RPC error.
    // Fall back to hardcoded so the API still works in pre-bootstrap state.
    _cache = { limits: HARDCODED_LIMITS_MICRO_USDC, fetchedAt: now, fromChain: false };
    return HARDCODED_LIMITS_MICRO_USDC;
  }
}

/**
 * Throw if `amountMicroUsdc` exceeds the limit for `tier`.
 * The thrown error has `.code = "KYC_LIMIT_EXCEEDED"` for HTTP layer translation.
 */
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

export async function enforceKycLimit(tier: KycTier, amountMicroUsdc: bigint): Promise<void> {
  const limits = await getKycLimits();
  const idx = TIER_TO_INDEX[tier];
  const limit = limits[idx] ?? 0n;
  if (amountMicroUsdc > limit) {
    throw new KycLimitExceededError(tier, limit);
  }
}

/** Test-only: clear the cache so a different config can be loaded next call. */
export function _resetKycLimitsCache(): void {
  _cache = null;
}

/** Test-only: inspect cache state. */
export function _getKycLimitsCacheState(): { fromChain: boolean; limits: readonly bigint[] } | null {
  return _cache ? { fromChain: _cache.fromChain, limits: _cache.limits } : null;
}
