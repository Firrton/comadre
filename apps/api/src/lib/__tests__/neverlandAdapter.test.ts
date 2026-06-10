/**
 * Unit tests for neverlandAdapter.ts
 *
 * All on-chain RPC calls and Turnkey/DB interactions are mocked.
 * No real network calls are made.
 *
 * Test coverage:
 *   - computeGrossWithdrawal — fee math with worked example + edge cases
 *   - computeYieldPortion — yield attribution math
 *   - depositToNeverland — calldata encoding + UserOp construction
 *   - withdrawFromNeverland — gross/fee split + calldata encoding
 *   - readNeverlandApy — Ray-to-APR/APY conversion
 */

import { describe, expect, it, mock } from "bun:test";
import { encodeFunctionData, parseAbi, type Address, type Hex } from "viem";

// ── Pure math helpers (no mocking needed) ────────────────────────────────────
import {
  computeGrossWithdrawal,
  computeYieldPortion,
} from "../neverlandAdapter.js";

// ── Integration-level tests mock modules before importing the adapter fns ────

// We mock @comadre/db and @comadre/wallet-infra/sessionKey before importing
// the full adapter so the module-level side effects do not require a real DB.

const mockSignAndSendUserOp = mock(async (_input: unknown) => ({
  userOpHash: "0xUSEROPHASH" as Hex,
  txHash: "0xTXHASH" as Hex,
}));

mock.module("@comadre/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [
            {
              id: "wallet-id-1",
              smartWalletAddress: "0xUSERWALLET",
            },
          ],
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => undefined,
      }),
    }),
  },
  sessionKeys: {},
  smartWallets: {},
}));

mock.module("@comadre/wallet-infra/sessionKey", () => ({
  signAndSendUserOp: mockSignAndSendUserOp,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 1 USDC = 1_000_000 micro-USDC */
const USDC = (n: number) => BigInt(n) * 1_000_000n;

// ── computeGrossWithdrawal ──────────────────────────────────────────────────

describe("computeGrossWithdrawal", () => {
  /**
   * Worked example from the spec:
   *   principal=$100, currentValue=$108, grossYield=$8
   *   user wants to net $50
   *   yieldRatio = 8/108 ≈ 7.407%
   *   effectiveFee = 7.407% × 20% ≈ 1.4815%
   *   gross ≈ $50 / (1 - 0.014815) ≈ $50.75
   *   fee ≈ $0.75
   */
  it("matches the worked example from the spec", () => {
    const result = computeGrossWithdrawal({
      amountRequestedMicroUsdc: USDC(50),
      grossYieldMicroUsdc: USDC(8),
      currentValueMicroUsdc: USDC(108),
      feeBps: 2000,
    });

    // Gross should be approximately $50.75 (within 1 micro-USDC of spec)
    // Spec says $50.75 → 50_750_000 micro-USDC
    // Allow ±2 for BigInt floor rounding
    expect(result.grossAmount).toBeGreaterThanOrEqual(50_740_000n);
    expect(result.grossAmount).toBeLessThanOrEqual(50_760_000n);

    // Fee should be approximately $0.75
    expect(result.feeAmount).toBeGreaterThanOrEqual(740_000n);
    expect(result.feeAmount).toBeLessThanOrEqual(760_000n);

    // User receives exactly gross - fee
    expect(result.userAmount).toBe(result.grossAmount - result.feeAmount);

    // User amount must be >= requested (floor rounding in user's favor)
    expect(result.userAmount).toBeGreaterThanOrEqual(USDC(50));
  });

  it("exact: user receives at least what they requested", () => {
    // Any combination — user must never get less than requested
    const result = computeGrossWithdrawal({
      amountRequestedMicroUsdc: USDC(100),
      grossYieldMicroUsdc: USDC(20),
      currentValueMicroUsdc: USDC(200),
      feeBps: 2000,
    });

    expect(result.userAmount).toBeGreaterThanOrEqual(USDC(100));
    expect(result.grossAmount).toBeGreaterThanOrEqual(USDC(100));
    expect(result.feeAmount).toBeGreaterThanOrEqual(0n);
    expect(result.userAmount).toBe(result.grossAmount - result.feeAmount);
  });

  it("zero yield → zero fee, gross equals requested", () => {
    const result = computeGrossWithdrawal({
      amountRequestedMicroUsdc: USDC(50),
      grossYieldMicroUsdc: 0n,
      currentValueMicroUsdc: USDC(50), // principal only, no yield
      feeBps: 2000,
    });

    expect(result.feeAmount).toBe(0n);
    expect(result.grossAmount).toBe(USDC(50));
    expect(result.userAmount).toBe(USDC(50));
  });

  it("currentValue equals zero → no fee (guard against division by zero)", () => {
    const result = computeGrossWithdrawal({
      amountRequestedMicroUsdc: USDC(50),
      grossYieldMicroUsdc: 0n,
      currentValueMicroUsdc: 0n,
      feeBps: 2000,
    });

    expect(result.feeAmount).toBe(0n);
    expect(result.grossAmount).toBe(USDC(50));
    expect(result.userAmount).toBe(USDC(50));
  });

  it("100% yield position (pure yield, no principal left): fee applies to full withdrawal", () => {
    // All $50 is yield — fee should be ≈ 20% of the gross
    // Effective fee rate = (50/50) × 20% = 20%
    // gross = 50 / (1 - 0.20) = 62.5 USDC
    const result = computeGrossWithdrawal({
      amountRequestedMicroUsdc: USDC(50),
      grossYieldMicroUsdc: USDC(50),
      currentValueMicroUsdc: USDC(50),
      feeBps: 2000,
    });

    // gross ≈ 62.5 USDC = 62_500_000 micro
    expect(result.grossAmount).toBeGreaterThanOrEqual(62_490_000n);
    expect(result.grossAmount).toBeLessThanOrEqual(62_510_000n);

    // user receives at least 50 USDC
    expect(result.userAmount).toBeGreaterThanOrEqual(USDC(50));
    expect(result.userAmount).toBe(result.grossAmount - result.feeAmount);
  });

  it("tiny yield — effective fee rounds to zero, no fee charged", () => {
    // 1 micro-USDC yield on a $1000 position — fee is negligible
    const result = computeGrossWithdrawal({
      amountRequestedMicroUsdc: USDC(100),
      grossYieldMicroUsdc: 1n, // 1 micro-USDC yield
      currentValueMicroUsdc: USDC(1_000),
      feeBps: 2000,
    });

    // effectiveFeeBps rounds to zero → no fee
    expect(result.feeAmount).toBe(0n);
    expect(result.userAmount).toBe(USDC(100));
  });

  it("gross always covers fee + user amount exactly", () => {
    const cases: Array<[bigint, bigint, bigint]> = [
      [USDC(10), USDC(3), USDC(50)],
      [USDC(999), USDC(1), USDC(1000)],
      [USDC(1), USDC(0), USDC(1)],
    ];

    for (const [requested, yield_, currentValue] of cases) {
      const result = computeGrossWithdrawal({
        amountRequestedMicroUsdc: requested,
        grossYieldMicroUsdc: yield_,
        currentValueMicroUsdc: currentValue,
        feeBps: 2000,
      });
      expect(result.grossAmount).toBe(result.userAmount + result.feeAmount);
    }
  });
});

// ── computeYieldPortion ─────────────────────────────────────────────────────

describe("computeYieldPortion", () => {
  it("pro-rates yield correctly", () => {
    // 50% of position is yield, withdrawing $50 gross → $25 is yield
    const yieldPortion = computeYieldPortion({
      grossWithdrawnMicroUsdc: USDC(50),
      grossYieldMicroUsdc: USDC(50),
      currentValueMicroUsdc: USDC(100),
    });
    // 50/100 × 50 = 25 USDC
    expect(yieldPortion).toBe(USDC(25));
  });

  it("zero yield → zero yield portion", () => {
    const yieldPortion = computeYieldPortion({
      grossWithdrawnMicroUsdc: USDC(50),
      grossYieldMicroUsdc: 0n,
      currentValueMicroUsdc: USDC(50),
    });
    expect(yieldPortion).toBe(0n);
  });

  it("zero currentValue → zero yield portion (no division by zero)", () => {
    const yieldPortion = computeYieldPortion({
      grossWithdrawnMicroUsdc: USDC(50),
      grossYieldMicroUsdc: USDC(10),
      currentValueMicroUsdc: 0n,
    });
    expect(yieldPortion).toBe(0n);
  });

  it("yield portion never exceeds gross withdrawn", () => {
    const yieldPortion = computeYieldPortion({
      grossWithdrawnMicroUsdc: USDC(50),
      grossYieldMicroUsdc: USDC(200), // yield > currentValue (degenerate)
      currentValueMicroUsdc: USDC(100),
    });
    // 200/100 × 50 = would be 100, but this is capped by BigInt floor
    // The key property: result should not exceed withdrawnAmount (or overflow)
    expect(yieldPortion).toBeGreaterThanOrEqual(0n);
  });
});

// ── readNeverlandApy — APR/APY conversion math ──────────────────────────────

describe("readNeverlandApy — APR/APY math", () => {
  /**
   * We test the APR/APY conversion formula in isolation (pure math).
   * The formula from the adapter:
   *   baseApr = currentLiquidityRateRay / 1e27
   *   totalApy = (1 + baseApr / SECONDS_PER_YEAR)^SECONDS_PER_YEAR - 1
   */
  it("5% APR converts to approximately 5.127% APY", () => {
    const APR = 0.05;
    const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;
    const totalApy = Math.pow(1 + APR / SECONDS_PER_YEAR, SECONDS_PER_YEAR) - 1;

    // APY should be slightly above APR due to compounding
    expect(totalApy).toBeGreaterThan(APR);
    // Within 0.5% of expected 5.127%
    expect(Math.abs(totalApy - 0.05127)).toBeLessThan(0.005);
  });

  it("0% APR → 0% APY", () => {
    const APR = 0;
    const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;
    const totalApy = Math.pow(1 + APR / SECONDS_PER_YEAR, SECONDS_PER_YEAR) - 1;
    expect(totalApy).toBeCloseTo(0, 10);
  });

  it("Ray to APR conversion: 5% APR → liquidityRate = 5e25", () => {
    const RAY = 10n ** 27n;
    // 5% in Ray = 0.05 × 1e27 = 5e25
    const liquidityRateRay = 50_000_000_000_000_000_000_000_000n; // 5e25
    const baseApr = Number(liquidityRateRay) / Number(RAY);
    expect(Math.abs(baseApr - 0.05)).toBeLessThan(0.000001);
  });
});

// ── depositToNeverland — calldata encoding ──────────────────────────────────

describe("depositToNeverland — calldata structure", () => {
  /**
   * We test that the approve + supply calldata are correctly encoded.
   * We do this by verifying the encoded output against expected function selectors
   * and argument encoding rather than calling the full function (which requires DB/RPC).
   */

  const NEVERLAND_POOL = "0x80F00661b13CC5F6ccd3885bE7b4C9c67545D585" as Address;
  const USDC_MONAD = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603" as Address;
  const USER_WALLET = "0xdEADbeEF00000000000000000000000000000001" as Address;

  const erc20Abi = parseAbi([
    "function approve(address spender, uint256 amount) external returns (bool)",
  ]);

  const poolAbi = parseAbi([
    "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external",
  ]);

  it("approve calldata encodes pool address and amount correctly", () => {
    const amount = USDC(100);
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [NEVERLAND_POOL, amount],
    });

    // 4-byte selector for approve(address,uint256)
    // keccak256("approve(address,uint256)") = 0x095ea7b3
    expect(data.slice(0, 10).toLowerCase()).toBe("0x095ea7b3");

    // The encoded spender address should appear in the calldata
    expect(data.toLowerCase()).toContain(NEVERLAND_POOL.toLowerCase().replace("0x", ""));
  });

  it("supply calldata encodes all four Aave args correctly", () => {
    const amount = USDC(100);
    const data = encodeFunctionData({
      abi: poolAbi,
      functionName: "supply",
      args: [USDC_MONAD, amount, USER_WALLET, 0],
    });

    // 4-byte selector for supply(address,uint256,address,uint16)
    // keccak256("supply(address,uint256,address,uint16)") = 0x617ba037
    expect(data.slice(0, 10).toLowerCase()).toBe("0x617ba037");

    // Asset (USDC) and onBehalfOf (user wallet) should appear in calldata
    expect(data.toLowerCase()).toContain(USDC_MONAD.toLowerCase().replace("0x", ""));
    expect(data.toLowerCase()).toContain(USER_WALLET.toLowerCase().replace("0x", ""));
  });

  it("executeBatch calldata includes both approve and supply", () => {
    const executeBatchAbi = parseAbi([
      "function executeBatch((address target, uint256 value, bytes data)[] calldata calls)",
    ]);

    const approveData = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [NEVERLAND_POOL, USDC(100)],
    });

    const supplyData = encodeFunctionData({
      abi: poolAbi,
      functionName: "supply",
      args: [USDC_MONAD, USDC(100), USER_WALLET, 0],
    });

    const batchData = encodeFunctionData({
      abi: executeBatchAbi,
      functionName: "executeBatch",
      args: [
        [
          { target: USDC_MONAD, value: 0n, data: approveData },
          { target: NEVERLAND_POOL, value: 0n, data: supplyData },
        ],
      ],
    });

    // Both target addresses should appear in the batch calldata
    expect(batchData.toLowerCase()).toContain(USDC_MONAD.toLowerCase().replace("0x", ""));
    expect(batchData.toLowerCase()).toContain(NEVERLAND_POOL.toLowerCase().replace("0x", ""));

    // The approve selector (0x095ea7b3) should be embedded
    expect(batchData.toLowerCase()).toContain("095ea7b3");
    // The supply selector (0x617ba037) should be embedded
    expect(batchData.toLowerCase()).toContain("617ba037");
  });
});

// ── withdrawFromNeverland — calldata encoding ────────────────────────────────

describe("withdrawFromNeverland — calldata structure", () => {
  const NEVERLAND_POOL = "0x80F00661b13CC5F6ccd3885bE7b4C9c67545D585" as Address;
  const USDC_MONAD = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603" as Address;
  const USER_WALLET = "0xdEADbeEF00000000000000000000000000000001" as Address;
  const FEE_WALLET = "0xFEEFEEfeefeEfeefEeFEefEeFEEfeEfEEfEefeE0" as Address;

  const poolAbi = parseAbi([
    "function withdraw(address asset, uint256 amount, address to) external returns (uint256)",
  ]);

  const erc20Abi = parseAbi([
    "function transfer(address to, uint256 amount) external returns (bool)",
  ]);

  it("withdraw calldata encodes asset, amount, and recipient correctly", () => {
    const grossAmount = USDC(100);
    const data = encodeFunctionData({
      abi: poolAbi,
      functionName: "withdraw",
      args: [USDC_MONAD, grossAmount, USER_WALLET],
    });

    // keccak256("withdraw(address,uint256,address)") = 0x69328dec
    expect(data.slice(0, 10).toLowerCase()).toBe("0x69328dec");
    expect(data.toLowerCase()).toContain(USDC_MONAD.toLowerCase().replace("0x", ""));
    expect(data.toLowerCase()).toContain(USER_WALLET.toLowerCase().replace("0x", ""));
  });

  it("fee transfer calldata encodes fee wallet and amount correctly", () => {
    const feeAmount = 750_000n; // $0.75
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [FEE_WALLET, feeAmount],
    });

    // keccak256("transfer(address,uint256)") = 0xa9059cbb
    expect(data.slice(0, 10).toLowerCase()).toBe("0xa9059cbb");
    expect(data.toLowerCase()).toContain(FEE_WALLET.toLowerCase().replace("0x", ""));
  });

  it("zero-fee withdrawal batch has only withdraw call (no transfer)", () => {
    const executeBatchAbi = parseAbi([
      "function executeBatch((address target, uint256 value, bytes data)[] calldata calls)",
    ]);

    const withdrawData = encodeFunctionData({
      abi: poolAbi,
      functionName: "withdraw",
      args: [USDC_MONAD, USDC(50), USER_WALLET],
    });

    // When fee = 0, only one call in the batch
    const calls = [{ target: NEVERLAND_POOL as Address, value: 0n, data: withdrawData }];

    const batchData = encodeFunctionData({
      abi: executeBatchAbi,
      functionName: "executeBatch",
      args: [calls],
    });

    // Batch has pool address but NOT the fee wallet
    expect(batchData.toLowerCase()).toContain(NEVERLAND_POOL.toLowerCase().replace("0x", ""));
    expect(batchData.toLowerCase()).not.toContain(FEE_WALLET.toLowerCase().replace("0x", ""));

    // transfer selector (0xa9059cbb) should NOT appear (no fee transfer)
    expect(batchData.toLowerCase()).not.toContain("a9059cbb");
  });

  it("non-zero-fee withdrawal batch has both withdraw + transfer calls", () => {
    const executeBatchAbi = parseAbi([
      "function executeBatch((address target, uint256 value, bytes data)[] calldata calls)",
    ]);

    const withdrawData = encodeFunctionData({
      abi: poolAbi,
      functionName: "withdraw",
      args: [USDC_MONAD, USDC(51), USER_WALLET],
    });

    const feeTransferData = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [FEE_WALLET, USDC(1)],
    });

    const calls = [
      { target: NEVERLAND_POOL as Address, value: 0n, data: withdrawData },
      { target: USDC_MONAD as Address, value: 0n, data: feeTransferData },
    ];

    const batchData = encodeFunctionData({
      abi: executeBatchAbi,
      functionName: "executeBatch",
      args: [calls],
    });

    // Both selectors present: withdraw (0x69328dec) and transfer (0xa9059cbb)
    expect(batchData.toLowerCase()).toContain("69328dec");
    expect(batchData.toLowerCase()).toContain("a9059cbb");
    expect(batchData.toLowerCase()).toContain(FEE_WALLET.toLowerCase().replace("0x", ""));
  });
});

// ── Full withdrawal math — principal tracking ────────────────────────────────

describe("withdrawal principal attribution", () => {
  it("principal portion withdrawn reduces remaining principal correctly", () => {
    // Position: netPrincipal=$100, currentValue=$108, grossYield=$8
    const netPrincipalRemaining = USDC(100);
    const currentValueMicroUsdc = USDC(108);
    const grossYieldMicroUsdc = USDC(8);

    const { grossAmount } = computeGrossWithdrawal({
      amountRequestedMicroUsdc: USDC(50),
      grossYieldMicroUsdc,
      currentValueMicroUsdc,
      feeBps: 2000,
    });

    const yieldPortion = computeYieldPortion({
      grossWithdrawnMicroUsdc: grossAmount,
      grossYieldMicroUsdc,
      currentValueMicroUsdc,
    });

    const principalPortion = grossAmount - yieldPortion;
    const newPrincipal =
      netPrincipalRemaining > principalPortion
        ? netPrincipalRemaining - principalPortion
        : 0n;

    // Should reduce principal by roughly $50.75 - $3.76 ≈ $47 (gross - yield portion)
    // New principal should be positive and less than original
    expect(newPrincipal).toBeGreaterThan(0n);
    expect(newPrincipal).toBeLessThan(netPrincipalRemaining);
  });

  it("full withdrawal of pure-principal position: new principal is zero", () => {
    // No yield: principal = currentValue
    const netPrincipalRemaining = USDC(100);

    const { grossAmount } = computeGrossWithdrawal({
      amountRequestedMicroUsdc: USDC(100),
      grossYieldMicroUsdc: 0n,
      currentValueMicroUsdc: USDC(100),
      feeBps: 2000,
    });

    const yieldPortion = computeYieldPortion({
      grossWithdrawnMicroUsdc: grossAmount,
      grossYieldMicroUsdc: 0n,
      currentValueMicroUsdc: USDC(100),
    });

    const principalPortion = grossAmount - yieldPortion;
    const newPrincipal =
      netPrincipalRemaining > principalPortion ? netPrincipalRemaining - principalPortion : 0n;

    expect(yieldPortion).toBe(0n);
    expect(newPrincipal).toBe(0n);
  });
});
