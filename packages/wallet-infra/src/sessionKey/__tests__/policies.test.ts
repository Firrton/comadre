/**
 * policies.test.ts — session key policy builders.
 *
 * These are the parameters that bound what the agent's session key can sign,
 * so the constants and builder output are pinned here on purpose: changing
 * them changes the on-chain authority of every newly installed key (and the
 * derived permissionId — see the buildPolicies docstring).
 */
import { describe, it, expect } from "bun:test";
import type { Address } from "viem";
import {
  DAILY_PER_CALL_USDC,
  DAILY_RATE_OPS,
  DAILY_RATE_INTERVAL_SECONDS,
  DAILY_VALIDITY_SECONDS,
  ELEVATED_PER_CALL_USDC,
  buildDailyPolicies,
  buildElevatedPolicies,
} from "../policies.js";

const COMADRE = "0x1111111111111111111111111111111111111111" as Address;
const USDC = "0x2222222222222222222222222222222222222222" as Address;
const POOL = "0x3333333333333333333333333333333333333333" as Address;
const FEE_WALLET = "0x4444444444444444444444444444444444444444" as Address;

describe("session key policy constants", () => {
  it("pins the daily-key signing bounds", () => {
    expect(DAILY_PER_CALL_USDC).toBe("50");
    expect(DAILY_RATE_OPS).toBe(10);
    expect(DAILY_RATE_INTERVAL_SECONDS).toBe(60);
    expect(DAILY_VALIDITY_SECONDS).toBe(30 * 86400);
  });

  it("keeps the elevated cap above the daily cap", () => {
    expect(Number(ELEVATED_PER_CALL_USDC)).toBeGreaterThan(
      Number(DAILY_PER_CALL_USDC),
    );
  });
});

describe("buildDailyPolicies", () => {
  it("returns the [call, rateLimit, timestamp] policy triple", () => {
    const policies = buildDailyPolicies(COMADRE, USDC);
    expect(policies).toHaveLength(3);
    for (const policy of policies) {
      expect(policy).toBeDefined();
    }
  });

  it("builds without throwing when Neverland params are included", () => {
    const policies = buildDailyPolicies(COMADRE, USDC, {
      neverlandPoolAddress: POOL,
      comadreFeeWallet: FEE_WALLET,
    });
    expect(policies).toHaveLength(3);
  });
});

describe("buildElevatedPolicies", () => {
  it("returns the policy triple", () => {
    expect(buildElevatedPolicies(COMADRE, USDC)).toHaveLength(3);
  });
});
