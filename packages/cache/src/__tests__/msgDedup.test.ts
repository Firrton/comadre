import { describe, it, expect, mock } from "bun:test";

/**
 * Unit tests for markMessageSeen.
 *
 * We mock the getRedis export from the client module so that the dedup
 * helper never touches real Redis or requires env vars.
 *
 * mock.module must be called BEFORE the module under test is imported
 * (Bun hoists mock.module calls).
 */

// Shared spy — reassign implementation per test below.
const mockSet = mock(async (..._args: unknown[]) => "OK" as unknown);

mock.module("../client.js", () => ({
  getRedis: () => ({ set: mockSet }),
}));

const { markMessageSeen } = await import("../msgDedup.js");

describe("markMessageSeen", () => {
  it("returns false when the SID is new (SET returns 'OK')", async () => {
    mockSet.mockImplementation(async () => "OK");
    const isDuplicate = await markMessageSeen("SM_new_001");
    expect(isDuplicate).toBe(false);
  });

  it("returns true when the SID is already seen (SET NX returns null)", async () => {
    mockSet.mockImplementation(async () => null);
    const isDuplicate = await markMessageSeen("SM_dup_001");
    expect(isDuplicate).toBe(true);
  });

  it("calls SET with key 'wa:msgsid:{sid}', value '1', nx:true, and a positive ex TTL", async () => {
    let capturedKey: unknown;
    let capturedValue: unknown;
    let capturedOpts: unknown;

    mockSet.mockImplementation(async (...args: unknown[]) => {
      [capturedKey, capturedValue, capturedOpts] = args;
      return "OK";
    });

    await markMessageSeen("SM_abc123");

    expect(capturedKey).toBe("wa:msgsid:SM_abc123");
    expect(capturedValue).toBe("1");
    const opts = capturedOpts as { nx?: boolean; ex?: number };
    expect(opts.nx).toBe(true);
    expect(typeof opts.ex).toBe("number");
    expect((opts.ex ?? 0) > 0).toBe(true);
  });
});
