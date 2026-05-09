import { describe, it, expect, beforeEach } from "bun:test";
import {
  enforceKycLimit,
  getKycLimits,
  KycLimitExceededError,
  _resetKycLimitsCache,
  _getKycLimitsCacheState,
} from "../kycLimits";

describe("kycLimits", () => {
  beforeEach(() => {
    _resetKycLimitsCache();
  });

  it("falls back to hardcoded defaults when on-chain config missing", async () => {
    // The real Solana RPC call will fail (no init_config in this test env),
    // and the helper falls back silently. We verify the values match the spec.
    const limits = await getKycLimits();
    expect(limits).toHaveLength(4);
    expect(limits[0]).toBe(10n * 1_000_000n);   // T0 = $10
    expect(limits[1]).toBe(100n * 1_000_000n);  // T1 = $100
    expect(limits[2]).toBe(1000n * 1_000_000n); // T2 = $1k
    expect(limits[3]).toBe(10000n * 1_000_000n); // T3 = $10k
    expect(_getKycLimitsCacheState()?.fromChain).toBe(false);
  });

  it("caches the result for 60s", async () => {
    await getKycLimits();
    const state1 = _getKycLimitsCacheState();
    await getKycLimits();
    const state2 = _getKycLimitsCacheState();
    expect(state1).toEqual(state2);
  });

  it("enforceKycLimit rejects amounts above tier limit", async () => {
    const overT0 = 11n * 1_000_000n;
    let caught: unknown;
    try {
      await enforceKycLimit("t0_demo", overT0);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(KycLimitExceededError);
    if (caught instanceof KycLimitExceededError) {
      expect(caught.code).toBe("KYC_LIMIT_EXCEEDED");
      expect(caught.tier).toBe("t0_demo");
      expect(caught.limitUsdc).toBe(10);
    }
  });

  it("enforceKycLimit accepts amounts at-or-below limit", async () => {
    await expect(enforceKycLimit("t0_demo", 10n * 1_000_000n)).resolves.toBeUndefined();
    await expect(enforceKycLimit("t1_lite", 50n * 1_000_000n)).resolves.toBeUndefined();
    await expect(enforceKycLimit("t3_pro", 5000n * 1_000_000n)).resolves.toBeUndefined();
  });

  it("higher tiers allow larger amounts", async () => {
    const amount = 500n * 1_000_000n; // $500
    await expect(enforceKycLimit("t1_lite", amount)).rejects.toThrow(KycLimitExceededError);
    await expect(enforceKycLimit("t2_standard", amount)).resolves.toBeUndefined();
  });
});
