/**
 * spendBudget.test.ts
 *
 * Unit tests for checkDailyBudget. Uses an injectable DI fake db handle
 * (chainable select stub) so no module mock of @comadre/db is needed —
 * module-level mocks leak across bun test files and break other suites.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { checkDailyBudget } from "../lib/spendBudget.js";

const SENDER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

/**
 * Build a fake db handle whose .select() chain returns the given microUSDC sum.
 *
 * The drizzle chain is: db.select({...}).from(...).where(...) → Promise<row[]>
 * We satisfy the minimal interface needed by checkDailyBudget.
 */
function makeFakeDb(sumMicroUsdc: bigint): Pick<typeof import("@comadre/db")["db"], "select"> {
  return {
    select: () =>
      ({
        from: () => ({
          where: () =>
            Promise.resolve([{ total: sumMicroUsdc.toString() }]),
        }),
      }) as never,
  };
}

describe("checkDailyBudget", () => {
  // Snapshot the env var and restore after each test so suite isolation is clean.
  let originalCap: string | undefined;
  beforeEach(() => {
    originalCap = process.env["DAILY_AGGREGATE_CAP_USDC"];
  });
  afterEach(() => {
    if (originalCap === undefined) {
      delete process.env["DAILY_AGGREGATE_CAP_USDC"];
    } else {
      process.env["DAILY_AGGREGATE_CAP_USDC"] = originalCap;
    }
  });

  it("returns ok:true when well under the cap (10 USDC spent, 100 USDC cap)", async () => {
    const db = makeFakeDb(10_000_000n); // 10 USDC
    const result = await checkDailyBudget(SENDER_ID, db);
    expect(result.ok).toBe(true);
  });

  it("returns ok:true when exactly at the cap (100 USDC = cap, inclusive boundary)", async () => {
    const db = makeFakeDb(100_000_000n); // exactly 100 USDC
    const result = await checkDailyBudget(SENDER_ID, db);
    expect(result.ok).toBe(true);
  });

  it("returns ok:false when one microUSDC over the cap", async () => {
    const db = makeFakeDb(100_000_001n); // 100.000001 USDC
    const result = await checkDailyBudget(SENDER_ID, db);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.spentMicroUsdc).toBe(100_000_001n);
      expect(result.capMicroUsdc).toBe(100_000_000n);
    }
  });

  it("returns ok:false with correct spent/cap values when clearly over cap", async () => {
    const db = makeFakeDb(150_000_000n); // 150 USDC
    const result = await checkDailyBudget(SENDER_ID, db);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.spentMicroUsdc).toBe(150_000_000n);
      expect(result.capMicroUsdc).toBe(100_000_000n);
    }
  });

  it("uses 100 USDC default cap when env var is absent", async () => {
    delete process.env["DAILY_AGGREGATE_CAP_USDC"];
    // The module caches CAP_MICRO_USDC at load time from the env var — since
    // the default is baked in as "100", the cap we test against is 100_000_000n.
    // We verify the interface contract: 101 USDC should fail, 99 USDC should pass.
    const over = makeFakeDb(101_000_000n);
    const under = makeFakeDb(99_000_000n);
    const overResult = await checkDailyBudget(SENDER_ID, over);
    const underResult = await checkDailyBudget(SENDER_ID, under);
    expect(overResult.ok).toBe(false);
    expect(underResult.ok).toBe(true);
  });

  it("treats a zero sum (no prior transfers) as well under cap", async () => {
    const db = makeFakeDb(0n);
    const result = await checkDailyBudget(SENDER_ID, db);
    expect(result.ok).toBe(true);
  });
});
