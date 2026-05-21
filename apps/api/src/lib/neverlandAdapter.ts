/**
 * Neverland yield protocol adapter for Comadre (Monad mainnet).
 *
 * Neverland is an Aave V3 fork deployed on Monad mainnet. Comadre users
 * deposit USDC into Neverland's Pool, receive interest-bearing nUSDC, and
 * Comadre takes a 20% performance fee on the YIELD ONLY when users withdraw.
 *
 * CRITICAL: Comadre never holds user funds.
 *
 * Money flow:
 *   DEPOSIT: User Kernel wallet → USDC.approve(Pool) + Pool.supply → nUSDC in user wallet
 *   WITHDRAW: Pool.withdraw → user's Kernel wallet gets USDC → USDC.transfer fee → COMADRE_FEE_WALLET
 *
 * All signing happens via Turnkey HSM through signAndSendUserOp.
 */

import {
  createPublicClient,
  defineChain,
  encodeFunctionData,
  parseAbi,
  http,
  type Address,
  type Hex,
} from "viem";
import { and, eq, gt } from "drizzle-orm";
import { db, sessionKeys, smartWallets } from "@comadre/db";
import { signAndSendUserOp } from "@comadre/wallet-infra/sessionKey";

/**
 * Monad mainnet (chain ID 143) defined inline to avoid viem version mismatch
 * between the workspace root and @comadre/wallet-infra.
 */
const monadMainnet = defineChain({
  id: 143,
  name: "Monad",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.monad.xyz"] },
  },
  blockExplorers: {
    default: { name: "MonadScan", url: "https://monadscan.com" },
  },
});

// ---------------------------------------------------------------------------
// Contract addresses — Monad mainnet
// ---------------------------------------------------------------------------

/**
 * Neverland Pool (Aave V3 fork) — Monad mainnet.
 * env: NEVERLAND_POOL_ADDRESS
 */
const NEVERLAND_POOL =
  (process.env["NEVERLAND_POOL_ADDRESS"] as Address | undefined) ??
  "0x80F00661b13CC5F6ccd3885bE7b4C9c67545D585";

/**
 * USDC token on Monad mainnet.
 * env: USDC_MONAD_ADDRESS
 */
const USDC_MONAD =
  (process.env["USDC_MONAD_ADDRESS"] as Address | undefined) ??
  "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";

/**
 * nUSDC — Neverland's interest-bearing USDC token (Aave aToken equivalent).
 * env: N_USDC_ADDRESS
 */
const N_USDC =
  (process.env["N_USDC_ADDRESS"] as Address | undefined) ??
  "0x38648958836eA88b368b4ac23b86Ad44B0fe7508";

/**
 * UI Pool Data Provider (read-only helper).
 * env: UI_POOL_DATA_PROVIDER_ADDRESS
 */
const _UI_POOL_DATA_PROVIDER =
  (process.env["UI_POOL_DATA_PROVIDER_ADDRESS"] as Address | undefined) ??
  "0x0733e79171dd5A5E8aF41E387c6299bCfE6a7e55";

/**
 * DUST Rewards Controller.
 * env: DUST_REWARDS_CONTROLLER_ADDRESS
 */
const _DUST_REWARDS_CONTROLLER =
  (process.env["DUST_REWARDS_CONTROLLER_ADDRESS"] as Address | undefined) ??
  "0x57ea245cCbFAb074baBb9d01d1F0c60525E52cec";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Seconds in a year (365 days, no leap adjustment for APR/APY approximation). */
const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

/** Ray = 1e27 — Aave's fixed-point denominator for rates and liquidity indices. */
const RAY = 10n ** 27n;

/** Basis points divisor: 10000 = 100.00% */
const BPS_DIVISOR = 10_000n;

// ---------------------------------------------------------------------------
// Minimal ABIs (parseAbi inline — no external ABI package needed)
// ---------------------------------------------------------------------------

const poolAbi = parseAbi([
  "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external",
  "function withdraw(address asset, uint256 amount, address to) external returns (uint256)",
  "function getReserveData(address asset) external view returns (uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt)",
  "function getUserAccountData(address user) external view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)",
]);

const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address owner) external view returns (uint256)",
  "function transfer(address to, uint256 amount) external returns (bool)",
]);

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface NeverlandDepositResult {
  ok: true;
  txHash: Hex;
  amountDepositedMicroUsdc: bigint;
  nUsdcReceived: bigint;
  /** liquidityIndex from Aave at time of deposit (Ray-scaled, 27 decimals). */
  exchangeRateAtDeposit: bigint;
}

export interface NeverlandWithdrawResult {
  ok: true;
  txHash: Hex;
  /** What the user asked to receive net. */
  amountRequestedMicroUsdc: bigint;
  /** What landed in the user's Kernel wallet. */
  userReceivedMicroUsdc: bigint;
  /** What was transferred to the Comadre fee wallet. */
  comadreFeeCollectedMicroUsdc: bigint;
  /** userReceived + comadreFeecollected — total pulled from Pool. */
  grossWithdrawnFromPool: bigint;
  /** Estimated yield portion of this withdrawal. */
  yieldPortionOfWithdrawal: bigint;
  /** Remaining principal after this withdrawal. */
  newPositionPrincipalMicroUsdc: bigint;
}

export interface NeverlandPosition {
  smartWalletAddress: Address;
  /** Sum of all deposits ever (from savings_positions). */
  principalDepositedMicroUsdc: bigint;
  /** Sum of principal portion of all withdrawals (from savings_positions). */
  principalWithdrawnMicroUsdc: bigint;
  /** principalDeposited - principalWithdrawn */
  netPrincipalMicroUsdc: bigint;
  /** On-chain nUSDC balance (live). */
  nUsdcBalance: bigint;
  /** On-chain USDC equivalent of nUSDC shares (live). */
  currentValueMicroUsdc: bigint;
  /** currentValue - netPrincipal (0 when no yield). */
  grossYieldMicroUsdc: bigint;
  /** grossYield * 0.80 — user's share after Comadre fee. */
  netYieldMicroUsdc: bigint;
  /** grossYield * 0.20 — Comadre's 20% performance fee on yield. */
  estimatedComadreFeeMicroUsdc: bigint;
}

export interface NeverlandApy {
  /** Pure lending APR (decimal, e.g. 0.05 = 5%). */
  baseApr: number;
  /** Approximated APY compounded annually. */
  totalApy: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Look up the active session key for a given smart wallet address.
 * Returns null if not found or no active session exists.
 */
async function getActiveSessionKey(smartWalletAddress: Address) {
  const walletRows = await db
    .select()
    .from(smartWallets)
    .where(eq(smartWallets.smartWalletAddress, smartWalletAddress.toLowerCase()))
    .limit(1);

  const wallet = walletRows[0];
  if (!wallet) return null;

  const keyRows = await db
    .select({
      id: sessionKeys.id,
      turnkeySubOrgId: sessionKeys.turnkeySubOrgId,
      turnkeyWalletId: sessionKeys.turnkeyWalletId,
      serializedPermission: sessionKeys.serializedPermission,
    })
    .from(sessionKeys)
    .where(
      and(
        eq(sessionKeys.smartWalletId, wallet.id),
        eq(sessionKeys.kind, "daily"),
        eq(sessionKeys.status, "active"),
        gt(sessionKeys.validUntil, new Date()),
      ),
    )
    .limit(1);

  return keyRows[0] ?? null;
}

/**
 * Create a read-only viem public client connected to Monad mainnet.
 * Uses MONAD_RPC_URL env var if set, falls back to the public mainnet RPC.
 */
export function createNeverlandPublicClient() {
  const rpcUrl = process.env["MONAD_RPC_URL"] ?? "https://rpc.monad.xyz";
  return createPublicClient({
    chain: monadMainnet,
    transport: http(rpcUrl),
  });
}

/**
 * Compute gross withdrawal amount G such that after fee deduction, the user
 * receives exactly amountRequested (R).
 *
 * The fee applies only to the yield portion of the withdrawal. If there is
 * no yield, the fee is zero and G = R.
 *
 * Math (BigInt-safe, no floats):
 *   yieldRatio      = grossYield / currentValue   (scaled by SCALE)
 *   effectiveFeeBps = yieldRatio * feeBps / SCALE  (effective fee on any withdrawal)
 *   grossAmount     = R * BPS_DIVISOR / (BPS_DIVISOR - effectiveFeeBps)
 *
 * We use SCALE = 1_000_000n to avoid integer division truncation in yieldRatio.
 *
 * Rounding: we FLOOR grossAmount (BigInt division truncates) which means the
 * user's actual net may be 1 micro-USDC more than requested — intentional,
 * as we must never over-charge the user.
 */
export function computeGrossWithdrawal(params: {
  amountRequestedMicroUsdc: bigint;
  grossYieldMicroUsdc: bigint;
  currentValueMicroUsdc: bigint;
  feeBps: number;
}): {
  grossAmount: bigint;
  feeAmount: bigint;
  userAmount: bigint;
} {
  const { amountRequestedMicroUsdc, grossYieldMicroUsdc, currentValueMicroUsdc, feeBps } = params;

  // No yield or zero position → no fee, gross equals request
  if (grossYieldMicroUsdc <= 0n || currentValueMicroUsdc <= 0n) {
    return {
      grossAmount: amountRequestedMicroUsdc,
      feeAmount: 0n,
      userAmount: amountRequestedMicroUsdc,
    };
  }

  const feeBpsN = BigInt(feeBps);

  // Scale intermediate math to avoid integer division truncation.
  // SCALE represents 100% of position value in fixed-point.
  const SCALE = 1_000_000n;

  // yieldRatioScaled = (grossYield * SCALE) / currentValue
  const yieldRatioScaled = (grossYieldMicroUsdc * SCALE) / currentValueMicroUsdc;

  // effectiveFeeBps = yieldRatioScaled * feeBps / SCALE
  const effectiveFeeBps = (yieldRatioScaled * feeBpsN) / SCALE;

  // If effective fee rounds to zero (e.g., tiny yield + tiny position), no fee
  if (effectiveFeeBps === 0n) {
    return {
      grossAmount: amountRequestedMicroUsdc,
      feeAmount: 0n,
      userAmount: amountRequestedMicroUsdc,
    };
  }

  // grossAmount = R * BPS_DIVISOR / (BPS_DIVISOR - effectiveFeeBps)
  // FLOOR division → user may get 1 extra micro-USDC (acceptable, rounds in their favor)
  const denominator = BPS_DIVISOR - effectiveFeeBps;
  const grossAmount = (amountRequestedMicroUsdc * BPS_DIVISOR) / denominator;

  // feeAmount = gross * effectiveFeeBps / BPS_DIVISOR (FLOOR — never over-charge)
  const feeAmount = (grossAmount * effectiveFeeBps) / BPS_DIVISOR;

  // userAmount = gross - fee (user receives the remainder)
  const userAmount = grossAmount - feeAmount;

  return { grossAmount, feeAmount, userAmount };
}

/**
 * Determine how much of this withdrawal is attributable to yield vs principal.
 *
 * We use a pro-rata approach: each dollar withdrawn carries the same ratio
 * of yield as the overall position.
 *
 *   yieldPortion = withdrawal * (grossYield / currentValue)
 *
 * Scaled with SCALE to avoid truncation. FLOOR — rounds in user's favor.
 */
export function computeYieldPortion(params: {
  grossWithdrawnMicroUsdc: bigint;
  grossYieldMicroUsdc: bigint;
  currentValueMicroUsdc: bigint;
}): bigint {
  const { grossWithdrawnMicroUsdc, grossYieldMicroUsdc, currentValueMicroUsdc } = params;
  if (grossYieldMicroUsdc <= 0n || currentValueMicroUsdc <= 0n) return 0n;

  const SCALE = 1_000_000n;
  const yieldRatioScaled = (grossYieldMicroUsdc * SCALE) / currentValueMicroUsdc;
  return (grossWithdrawnMicroUsdc * yieldRatioScaled) / SCALE;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build and sign a UserOp via Kernel that executes in batch:
 *   1. USDC.approve(NEVERLAND_POOL, amountMicroUsdc)
 *   2. Pool.supply(USDC, amountMicroUsdc, smartWalletAddress, 0)
 *
 * The user's nUSDC lands in their Kernel wallet automatically (Aave mints
 * aTokens to the `onBehalfOf` address, which is the smart wallet).
 *
 * @throws if no active session key exists or if the UserOp fails.
 */
export async function depositToNeverland(params: {
  smartWalletAddress: Address;
  amountMicroUsdc: bigint;
}): Promise<NeverlandDepositResult> {
  const { smartWalletAddress, amountMicroUsdc } = params;

  const key = await getActiveSessionKey(smartWalletAddress);
  if (!key) {
    throw new Error(
      `[neverlandAdapter] No active session key for wallet ${smartWalletAddress}`,
    );
  }

  // Read the current liquidityIndex before depositing so we can track
  // the entry rate for yield calculation on withdrawal.
  const publicClient = createNeverlandPublicClient();
  const reserveData = await publicClient.readContract({
    address: NEVERLAND_POOL,
    abi: poolAbi,
    functionName: "getReserveData",
    args: [USDC_MONAD],
  });
  // reserveData[1] = liquidityIndex (128-bit Ray-scaled)
  const exchangeRateAtDeposit = BigInt(reserveData[1]);

  // Read nUSDC balance before deposit to compute shares received after.
  const nUsdcBefore = await publicClient.readContract({
    address: N_USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [smartWalletAddress],
  });

  // Build the approve calldata.
  const approveCalldata = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [NEVERLAND_POOL, amountMicroUsdc],
  });

  // Build the supply calldata. referralCode = 0 (no referral program).
  const supplyCalldata = encodeFunctionData({
    abi: poolAbi,
    functionName: "supply",
    args: [USDC_MONAD, amountMicroUsdc, smartWalletAddress, 0],
  });

  // Kernel executeBatch: encode two calls in a single UserOp.
  // Selector: executeBatch(Call[] calldata calls)
  // Each Call: { address target, uint256 value, bytes data }
  const executeBatchAbi = parseAbi([
    "function executeBatch((address target, uint256 value, bytes data)[] calldata calls)",
  ]);

  const batchCalldata = encodeFunctionData({
    abi: executeBatchAbi,
    functionName: "executeBatch",
    args: [
      [
        { target: USDC_MONAD, value: 0n, data: approveCalldata },
        { target: NEVERLAND_POOL, value: 0n, data: supplyCalldata },
      ],
    ],
  });

  // signAndSendUserOp sends to the Kernel account itself (self-call for batch).
  const result = await signAndSendUserOp({
    subOrgId: key.turnkeySubOrgId,
    walletId: key.turnkeyWalletId,
    serializedPermissionBlob: key.serializedPermission,
    to: smartWalletAddress,
    data: batchCalldata,
  });

  await db
    .update(sessionKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(sessionKeys.id, key.id));

  // Read nUSDC balance after to compute shares received.
  const nUsdcAfter = await publicClient.readContract({
    address: N_USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [smartWalletAddress],
  });

  const nUsdcReceived = nUsdcAfter - nUsdcBefore;

  return {
    ok: true,
    txHash: result.txHash,
    amountDepositedMicroUsdc: amountMicroUsdc,
    nUsdcReceived,
    exchangeRateAtDeposit,
  };
}

/**
 * Withdraw from Neverland and collect the performance fee, batched in a
 * single Kernel UserOp:
 *   1. Pool.withdraw(USDC, grossAmount, smartWalletAddress)
 *      → grossAmount = amountRequested + fee (fee applies only to yield)
 *   2. USDC.transfer(COMADRE_FEE_WALLET, feeAmount)
 *      → user's wallet ends up with exactly amountRequested
 *
 * Caller MUST pass principalRemaining (from DB) so we can correctly
 * attribute what portion is principal vs yield in this withdrawal.
 *
 * @throws if no active session key exists, no on-chain position, or UserOp fails.
 */
export async function withdrawFromNeverland(params: {
  smartWalletAddress: Address;
  amountRequestedMicroUsdc: bigint;
  netPrincipalRemaining: bigint;
  feeBps: number;
  comadreFeeWallet: Address;
}): Promise<NeverlandWithdrawResult> {
  const {
    smartWalletAddress,
    amountRequestedMicroUsdc,
    netPrincipalRemaining,
    feeBps,
    comadreFeeWallet,
  } = params;

  const key = await getActiveSessionKey(smartWalletAddress);
  if (!key) {
    throw new Error(
      `[neverlandAdapter] No active session key for wallet ${smartWalletAddress}`,
    );
  }

  // Read on-chain state to determine current position value.
  const publicClient = createNeverlandPublicClient();
  const nUsdcBalance = await publicClient.readContract({
    address: N_USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [smartWalletAddress],
  });

  // In Aave V3, nUSDC balance = USDC value (1:1 with small rounding on indexing).
  // currentValue ≈ nUSDC balance scaled by liquidity index. For first version we
  // treat nUSDC balance as the USDC equivalent (accurate within 1 wei for active position).
  const currentValueMicroUsdc = nUsdcBalance;

  // Gross yield = currentValue - netPrincipal. Clamp to 0 to avoid negative yield
  // (can happen if principalRemaining hasn't been updated after a prior withdraw).
  const grossYieldMicroUsdc =
    currentValueMicroUsdc > netPrincipalRemaining
      ? currentValueMicroUsdc - netPrincipalRemaining
      : 0n;

  // Compute how much to pull from the pool to give user exactly what they requested.
  const { grossAmount, feeAmount, userAmount } = computeGrossWithdrawal({
    amountRequestedMicroUsdc,
    grossYieldMicroUsdc,
    currentValueMicroUsdc,
    feeBps,
  });

  // Compute yield portion of this specific withdrawal.
  const yieldPortionOfWithdrawal = computeYieldPortion({
    grossWithdrawnMicroUsdc: grossAmount,
    grossYieldMicroUsdc,
    currentValueMicroUsdc,
  });

  // Remaining principal after this withdrawal.
  // The principal portion = grossWithdrawn - yieldPortion.
  const principalPortionWithdrawn = grossAmount - yieldPortionOfWithdrawal;
  const newPositionPrincipalMicroUsdc =
    netPrincipalRemaining > principalPortionWithdrawn
      ? netPrincipalRemaining - principalPortionWithdrawn
      : 0n;

  // Build the withdraw calldata. Pool sends USDC to smartWalletAddress.
  const withdrawCalldata = encodeFunctionData({
    abi: poolAbi,
    functionName: "withdraw",
    args: [USDC_MONAD, grossAmount, smartWalletAddress],
  });

  // Build the fee transfer calldata (only needed when fee > 0).
  const calls: Array<{ target: Address; value: bigint; data: Hex }> = [
    { target: NEVERLAND_POOL, value: 0n, data: withdrawCalldata },
  ];

  if (feeAmount > 0n) {
    const feeTransferCalldata = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [comadreFeeWallet, feeAmount],
    });
    calls.push({ target: USDC_MONAD, value: 0n, data: feeTransferCalldata });
  }

  const executeBatchAbi = parseAbi([
    "function executeBatch((address target, uint256 value, bytes data)[] calldata calls)",
  ]);

  const batchCalldata = encodeFunctionData({
    abi: executeBatchAbi,
    functionName: "executeBatch",
    args: [calls],
  });

  const result = await signAndSendUserOp({
    subOrgId: key.turnkeySubOrgId,
    walletId: key.turnkeyWalletId,
    serializedPermissionBlob: key.serializedPermission,
    to: smartWalletAddress,
    data: batchCalldata,
  });

  await db
    .update(sessionKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(sessionKeys.id, key.id));

  return {
    ok: true,
    txHash: result.txHash,
    amountRequestedMicroUsdc,
    userReceivedMicroUsdc: userAmount,
    comadreFeeCollectedMicroUsdc: feeAmount,
    grossWithdrawnFromPool: grossAmount,
    yieldPortionOfWithdrawal,
    newPositionPrincipalMicroUsdc,
  };
}

/**
 * Read user's full position state from on-chain balances + DB-provided principals.
 *
 * The caller (route handler) passes principalDeposited/Withdrawn from
 * savings_positions table. We resolve on-chain balance and compute yield.
 */
export async function readNeverlandPosition(params: {
  smartWalletAddress: Address;
  principalDepositedMicroUsdc: bigint;
  principalWithdrawnMicroUsdc: bigint;
  feeBps: number;
}): Promise<NeverlandPosition> {
  const {
    smartWalletAddress,
    principalDepositedMicroUsdc,
    principalWithdrawnMicroUsdc,
    feeBps,
  } = params;

  const publicClient = createNeverlandPublicClient();

  const nUsdcBalance = await publicClient.readContract({
    address: N_USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [smartWalletAddress],
  });

  const currentValueMicroUsdc = nUsdcBalance;
  const netPrincipalMicroUsdc =
    principalDepositedMicroUsdc > principalWithdrawnMicroUsdc
      ? principalDepositedMicroUsdc - principalWithdrawnMicroUsdc
      : 0n;

  const grossYieldMicroUsdc =
    currentValueMicroUsdc > netPrincipalMicroUsdc
      ? currentValueMicroUsdc - netPrincipalMicroUsdc
      : 0n;

  const feeBpsN = BigInt(feeBps);
  // estimatedFee = grossYield * feeBps / 10000
  const estimatedComadreFeeMicroUsdc = (grossYieldMicroUsdc * feeBpsN) / BPS_DIVISOR;
  const netYieldMicroUsdc = grossYieldMicroUsdc - estimatedComadreFeeMicroUsdc;

  return {
    smartWalletAddress,
    principalDepositedMicroUsdc,
    principalWithdrawnMicroUsdc,
    netPrincipalMicroUsdc,
    nUsdcBalance,
    currentValueMicroUsdc,
    grossYieldMicroUsdc,
    netYieldMicroUsdc,
    estimatedComadreFeeMicroUsdc,
  };
}

/**
 * Read current APY from Pool.getReserveData(USDC).currentLiquidityRate.
 *
 * currentLiquidityRate is the supply APR in Ray (27 decimals).
 * APR = currentLiquidityRate / 1e27
 * APY ≈ (1 + APR / SECONDS_PER_YEAR)^SECONDS_PER_YEAR - 1
 *
 * We use the continuous compounding approximation for v1:
 *   APY ≈ e^APR - 1  (sufficiently accurate for APR < 50%)
 *
 * No signing required — pure read-only RPC call.
 */
export async function readNeverlandApy(): Promise<NeverlandApy> {
  const publicClient = createNeverlandPublicClient();

  const reserveData = await publicClient.readContract({
    address: NEVERLAND_POOL,
    abi: poolAbi,
    functionName: "getReserveData",
    args: [USDC_MONAD],
  });

  // reserveData[2] = currentLiquidityRate (128-bit, Ray-scaled)
  const currentLiquidityRateRay = BigInt(reserveData[2]);

  // Convert Ray to decimal APR: divide by 1e27.
  // Use floating point only for the final APR/APY output — not for any BigInt money math.
  const baseApr = Number(currentLiquidityRateRay) / Number(RAY);

  // Compound annually: APY = (1 + APR / SECONDS_PER_YEAR)^SECONDS_PER_YEAR - 1
  const totalApy = Math.pow(1 + baseApr / SECONDS_PER_YEAR, SECONDS_PER_YEAR) - 1;

  return { baseApr, totalApy };
}
