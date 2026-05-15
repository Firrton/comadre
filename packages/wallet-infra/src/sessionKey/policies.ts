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

/**
 * Comadre's full Solidity ABI for the functions the agent may call on the
 * user's behalf. Keep this list narrow — every selector here widens what an
 * over-helpful or hijacked LLM can sign.
 */
const comadreAbi = parseAbi([
  "function contribute(bytes32 tandaKey) external",
  "function joinTanda(bytes32 tandaKey, uint8 turnNumber) external",
  "function openDispute(bytes32 tandaKey, bytes32 reasonHash) external returns (bytes32)",
  "function voteDispute(bytes32 disputeKey, bool continueTanda) external",
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

  const callPolicy = toCallPolicy({
    policyVersion: CallPolicyVersion.V0_0_5,
    permissions: [
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
        args: [null, null],
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
    ],
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

export function buildDailyPolicies(comadre: Address, usdc: Address) {
  return buildPolicies({
    comadreAddress: comadre,
    usdcAddress: usdc,
    perCallCapUsdc: DAILY_PER_CALL_USDC,
    rateLimitCount: DAILY_RATE_OPS,
    rateLimitInterval: DAILY_RATE_INTERVAL_SECONDS,
    validitySeconds: DAILY_VALIDITY_SECONDS,
  });
}

export function buildElevatedPolicies(comadre: Address, usdc: Address) {
  return buildPolicies({
    comadreAddress: comadre,
    usdcAddress: usdc,
    perCallCapUsdc: ELEVATED_PER_CALL_USDC,
    rateLimitCount: ELEVATED_RATE_OPS,
    rateLimitInterval: ELEVATED_RATE_INTERVAL_SECONDS,
    validitySeconds: ELEVATED_VALIDITY_SECONDS,
  });
}
