/**
 * payoutCrank.test.ts
 *
 * Verifies payoutCrank logic using a mocked DB.
 *
 * Since @comadre/db requires DATABASE_URL at import time, we intercept via
 * Bun's module mock to avoid needing a live Postgres connection in unit tests.
 */

import { describe, it, expect, mock, beforeEach } from "bun:test";

// ── DB mock setup ─────────────────────────────────────────────────────────────

const updateMock = mock(async () => undefined);

// Track calls for assertions
let selectCallCount = 0;
let updateCallCount = 0;

// Simulate one due tanda returned from the DB
const mockDueTanda = {
  id: "tanda-pda-abc123",
  tandaId: BigInt(1),
  currentTurn: 2,
  memberTarget: 5,
  nextPayoutTs: new Date(Date.now() - 60_000), // 1 min ago
};

// The Drizzle query builder uses method chains (.select().from().where()).
// We stub the entire chain to return our fixture on the first call (select)
// and a no-op on the second (update).
let callIndex = 0;

const dbMock = {
  select: () => ({
    from: () => ({
      where: async () => {
        callIndex++;
        if (callIndex === 1) return [mockDueTanda];
        return [];
      },
    }),
  }),
  update: () => ({
    set: () => ({
      where: updateMock,
    }),
  }),
};

// Patch module resolution before importing the job
mock.module("@comadre/db", () => ({
  db: dbMock,
  tandas: { id: "id", state: "state", nextPayoutTs: "next_payout_ts" },
}));

mock.module("../lib/logger.js", () => ({
  logger: {
    child: () => ({
      info: mock(() => undefined),
      warn: mock(() => undefined),
      error: mock(() => undefined),
    }),
  },
}));

const txStubCalls: Array<{ key: string; plan: unknown }> = [];

mock.module("../lib/txStub.js", () => ({
  makeTxStub: (key: string, plan: unknown) => {
    txStubCalls.push({ key, plan });
  },
}));

// Import AFTER mocks are set up
const { payoutCrank } = await import("../jobs/payoutCrank.js");

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("payoutCrank", () => {
  beforeEach(() => {
    callIndex = 0;
    txStubCalls.length = 0;
    updateMock.mockClear();
  });

  it("calls makeTxStub for each due tanda", async () => {
    await payoutCrank();

    expect(txStubCalls.length).toBe(1);
    const call = txStubCalls[0];
    expect(call).toBeDefined();
    if (call) {
      expect(call.key).toContain("payout:");
      expect(call.key).toContain("tanda-pda-abc123");
    }
  });

  it("updates lastSyncedAt for each processed tanda", async () => {
    await payoutCrank();

    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it("emits stub with correct instruction name", async () => {
    await payoutCrank();

    const call = txStubCalls[0];
    expect(call).toBeDefined();
    if (call) {
      const plan = call.plan as { instruction: string };
      expect(plan.instruction).toBe("payout");
    }
  });
});
