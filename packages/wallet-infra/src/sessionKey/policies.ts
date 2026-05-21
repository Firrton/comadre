import { type Address, parseAbi, parseUnits } from "viem";
import { CallPolicyVersion, ParamCondition, toCallPolicy } from "@zerodev/permissions/policies";
import { toRateLimitPolicy, toTimestampPolicy } from "@zerodev/permissions/policies";

/**
 * Default per-tx and rate-limit budgets for the DAILY session key. These map
 * 1:1 to the values in docs/WALLET_SECURITY.md §10. Bump cautiously.
 */
export const DAILY_PER_CALL_USDC = "50";
export const DAILY_RATE_OPS = 10;
export const DAILY_RATE_INTERVAL_SECONDS = 60;
export const DAILY_VALIDITY_SECONDS = 30 * 86400;

export const ELEVATED_PER_CALL_USDC = "1000";
export const ELEVATED_RATE_OPS = 1;
export const ELEVATED_RATE_INTERVAL_SECONDS = 300;
export const ELEVATED_VALIDITY_SECONDS = 86400;

const usdcAbi = parseAbi([
  "function transfer(address to, uint256 value) returns (bool)",
  "function approve(address spender, uint256 value) returns (bool)",
]);

// Aave V3 / Neverland Pool ABI — only the selectors the agent is allowed to call.
const neverlandPoolAbi = parseAbi([
  "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external",
  "function withdraw(address asset, uint256 amount, address to) external returns (uint256)",
]);

/**
 * Comadre's full Solidity ABI for the functions the agent may call on the
 * user's behalf. Keep this list narrow — every selector here widens what an
 * over-helpful or hijacked LLM can sign.
 */
const comadreAbi = parseAbi([
  "function contribute(bytes32 tandaKey) external",
  "function joinTanda(bytes32 tandaKey, uint8 turnNumber) external",
  "function openDispute(bytes32 tandaKey, bytes32 reasonHash) external returns (bytes32)",
  "function voteDispute(bytes32 tandaKey, bytes32 disputeKey, bool continueTanda) external",
  "function claimStake(bytes32 tandaKey) external",
]);

export interface BuildPoliciesInput {
  comadreAddress: Address;
  usdcAddress: Address;
  perCallCapUsdc: string;
  rateLimitCount: number;
  rateLimitInterval: number;
  validitySeconds: number;
  /** Optional: pin USDC transfer recipient (e.g. Comadre vault). Omit to allow any. */
  transferTargetPinTo?: Address;
  /**
   * Neverland (Aave V3) yield integration — both addresses must be provided
   * together to activate yield policies. When set, the session key gains:
   *   - USDC.approve(neverlandPoolAddress, *) — approval locked to pool only
   *   - Pool.supply(USDC, *, *, 0)
   *   - Pool.withdraw(USDC, *, *)
   *   - USDC.transfer(comadreFeeWallet, *) — fee collection, recipient locked
   */
  neverlandPoolAddress?: Address;
  comadreFeeWallet?: Address;
}

/**
 * Produces the ZeroDev policy array for a session key, in the exact order
 * the validator expects: [callPolicy, rateLimitPolicy, timestampPolicy].
 *
 * IMPORTANT: the `permissionId` ZeroDev derives is a function of (signer + policies),
 * so changing the order or contents here changes the on-chain plugin identity.
 * Persist the exact policy config alongside the session key blob for revocation.
 */
export function buildPolicies(input: BuildPoliciesInput) {
  const cap = parseUnits(input.perCallCapUsdc, 6);

  // Base permissions shared by all session keys.
  // Typed as any[] so that ZeroDev's deeply-discriminated union on `toCallPolicy`
  // does not reject entries when they are assembled dynamically from multiple ABIs.
  // Each individual entry is still structurally correct — only the array-level
  // union inference is bypassed here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const permissions: any[] = [
    // Comadre — no value transfer, args unconstrained (the contract enforces business rules).
    {
      target: input.comadreAddress,
      valueLimit: 0n,
      abi: comadreAbi,
      functionName: "contribute",
      args: [null],
    },
    {
      target: input.comadreAddress,
      valueLimit: 0n,
      abi: comadreAbi,
      functionName: "joinTanda",
      args: [null, null],
    },
    {
      target: input.comadreAddress,
      valueLimit: 0n,
      abi: comadreAbi,
      functionName: "openDispute",
      args: [null, null],
    },
    {
      target: input.comadreAddress,
      valueLimit: 0n,
      abi: comadreAbi,
      functionName: "voteDispute",
      args: [null, null, null],
    },
    {
      target: input.comadreAddress,
      valueLimit: 0n,
      abi: comadreAbi,
      functionName: "claimStake",
      args: [null],
    },

    // USDC.approve — pin the spender to Comadre, cap the amount.
    {
      target: input.usdcAddress,
      valueLimit: 0n,
      abi: usdcAbi,
      functionName: "approve",
      args: [
        { condition: ParamCondition.EQUAL, value: input.comadreAddress },
        { condition: ParamCondition.LESS_THAN_OR_EQUAL, value: cap },
      ],
    },

    // USDC.transfer — cap the amount. Recipient is enforced by the backend
    // before signing (not pinned on-chain to allow new contacts via OOB flow).
    {
      target: input.usdcAddress,
      valueLimit: 0n,
      abi: usdcAbi,
      functionName: "transfer",
      args: [
        input.transferTargetPinTo
          ? { condition: ParamCondition.EQUAL, value: input.transferTargetPinTo }
          : null,
        { condition: ParamCondition.LESS_THAN_OR_EQUAL, value: cap },
      ],
    },
  ];

  // ── Neverland / Aave V3 yield policies (optional) ─────────────────────────
  // Only appended when neverlandPoolAddress AND comadreFeeWallet are both
  // provided. Omitting them preserves the exact same on-chain policy
  // fingerprint for non-yield session keys.
  if (input.neverlandPoolAddress && input.comadreFeeWallet) {
    const pool = input.neverlandPoolAddress;
    const feeWallet = input.comadreFeeWallet;

    // USDC.approve — spender locked to Neverland pool; amount unconstrained
    // so the agent can set the exact deposit amount without a separate cap tx.
    permissions.push({
      target: input.usdcAddress,
      valueLimit: 0n,
      abi: usdcAbi,
      functionName: "approve",
      args: [
        { condition: ParamCondition.EQUAL, value: pool },
        null, // amount unconstrained — pool pulls exactly what supply() needs
      ],
    });

    // Pool.supply — asset locked to USDC; amount and onBehalfOf unconstrained
    // (agent always passes the user's own kernel wallet as onBehalfOf).
    permissions.push({
      target: pool,
      valueLimit: 0n,
      abi: neverlandPoolAbi,
      functionName: "supply",
      args: [
        { condition: ParamCondition.EQUAL, value: input.usdcAddress },
        null, // amount
        null, // onBehalfOf — scoped to the user; agent enforces this off-chain
        null, // referralCode
      ],
    });

    // Pool.withdraw — asset locked to USDC; amount and recipient unconstrained.
    permissions.push({
      target: pool,
      valueLimit: 0n,
      abi: neverlandPoolAbi,
      functionName: "withdraw",
      args: [
        { condition: ParamCondition.EQUAL, value: input.usdcAddress },
        null, // amount (uint256.max = full withdrawal)
        null, // to — recipient enforced by agent (user's EOA or kernel wallet)
      ],
    });

    // USDC.transfer — fee collection; recipient locked to Comadre fee wallet.
    // Amount unconstrained; the backend calculates fee = withdrawal * bps.
    permissions.push({
      target: input.usdcAddress,
      valueLimit: 0n,
      abi: usdcAbi,
      functionName: "transfer",
      args: [
        { condition: ParamCondition.EQUAL, value: feeWallet },
        null,
      ],
    });
  }

  const callPolicy = toCallPolicy({
    policyVersion: CallPolicyVersion.V0_0_5,
    permissions,
  });

  const rateLimit = toRateLimitPolicy({
    count: input.rateLimitCount,
    interval: input.rateLimitInterval,
  });

  const expiry = toTimestampPolicy({
    validAfter: 0,
    validUntil: Math.floor(Date.now() / 1000) + input.validitySeconds,
  });

  return [callPolicy, rateLimit, expiry];
}

export interface NeverlandParams {
  neverlandPoolAddress: Address;
  comadreFeeWallet: Address;
}

export function buildDailyPolicies(
  comadre: Address,
  usdc: Address,
  neverland?: NeverlandParams,
) {
  return buildPolicies({
    comadreAddress: comadre,
    usdcAddress: usdc,
    perCallCapUsdc: DAILY_PER_CALL_USDC,
    rateLimitCount: DAILY_RATE_OPS,
    rateLimitInterval: DAILY_RATE_INTERVAL_SECONDS,
    validitySeconds: DAILY_VALIDITY_SECONDS,
    neverlandPoolAddress: neverland?.neverlandPoolAddress,
    comadreFeeWallet: neverland?.comadreFeeWallet,
  });
}

export function buildElevatedPolicies(
  comadre: Address,
  usdc: Address,
  neverland?: NeverlandParams,
) {
  return buildPolicies({
    comadreAddress: comadre,
    usdcAddress: usdc,
    perCallCapUsdc: ELEVATED_PER_CALL_USDC,
    rateLimitCount: ELEVATED_RATE_OPS,
    rateLimitInterval: ELEVATED_RATE_INTERVAL_SECONDS,
    validitySeconds: ELEVATED_VALIDITY_SECONDS,
    neverlandPoolAddress: neverland?.neverlandPoolAddress,
    comadreFeeWallet: neverland?.comadreFeeWallet,
  });
}
