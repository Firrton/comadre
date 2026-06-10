/**
 * transfersMonadCas.test.ts
 *
 * Unit tests for the CAS (compare-and-swap) claim that closes the
 * double-confirmation TOCTOU in POST /resolve-confirmation: two concurrent
 * "sí" messages must never both reach the signer.
 *
 * `claimAwaitingConfirmation` takes an injectable db handle, so these tests
 * pass a fake that emulates the atomic UPDATE ... WHERE status =
 * 'awaiting_confirmation' RETURNING semantics. No module mocks: mocking
 * @comadre/db with mock.module leaks into every other test file in the
 * process (it broke savings.test.ts before this approach).
 */

import { describe, it, expect } from "bun:test";
import { claimAwaitingConfirmation } from "../routes/transfersMonad.js";

const TRANSFER_ID = "11111111-2222-3333-4444-555555555555";

const CLAIMED_ROW = {
  id: TRANSFER_ID,
  status: "pending",
} as never;

/**
 * Fake db handle reproducing Postgres CAS behavior: the first UPDATE matching
 * status='awaiting_confirmation' returns the row; every later attempt matches
 * nothing and returns []. `setCalls` records what the helper wrote.
 */
function makeCasFakeDb() {
  let claimed = false;
  const setCalls: object[] = [];
  const fake = {
    update: () => ({
      set: (values: object) => {
        setCalls.push(values);
        return {
          where: () => ({
            returning: async () => {
              if (claimed) return [];
              claimed = true;
              return [CLAIMED_ROW];
            },
          }),
        };
      },
    }),
  };
  return { fake: fake as never, setCalls };
}

describe("claimAwaitingConfirmation", () => {
  it("returns the row when the claim wins", async () => {
    const { fake } = makeCasFakeDb();
    const row = await claimAwaitingConfirmation(TRANSFER_ID, fake);
    expect(row).not.toBeNull();
    expect(row?.id).toBe(TRANSFER_ID);
  });

  it("returns null when the row was already claimed", async () => {
    const { fake } = makeCasFakeDb();
    await claimAwaitingConfirmation(TRANSFER_ID, fake);
    const loser = await claimAwaitingConfirmation(TRANSFER_ID, fake);
    expect(loser).toBeNull();
  });

  it("transitions the row to the pending pre-sign state", async () => {
    const { fake, setCalls } = makeCasFakeDb();
    await claimAwaitingConfirmation(TRANSFER_ID, fake);
    expect(setCalls).toEqual([{ status: "pending" }]);
  });

  it("two concurrent claims produce exactly one winner", async () => {
    const { fake } = makeCasFakeDb();
    const [a, b] = await Promise.all([
      claimAwaitingConfirmation(TRANSFER_ID, fake),
      claimAwaitingConfirmation(TRANSFER_ID, fake),
    ]);
    const winners = [a, b].filter((r) => r !== null);
    expect(winners).toHaveLength(1);
  });
});
