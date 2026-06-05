import { describe, it, expect } from "bun:test";
import { isSameAddress } from "../ownership.js";

describe("isSameAddress — case-insensitive EVM ownership check", () => {
  const A = "0x" + "a1".repeat(20);

  it("returns true for identical addresses", () => {
    expect(isSameAddress(A, A)).toBe(true);
  });

  it("is case-insensitive (DB stores lowercase, caller may be mixed case)", () => {
    expect(isSameAddress(A, A.toUpperCase())).toBe(true);
  });

  it("returns false for different addresses", () => {
    const B = "0x" + "b2".repeat(20);
    expect(isSameAddress(A, B)).toBe(false);
  });

  it("returns false when either address is missing (fail closed)", () => {
    expect(isSameAddress(A, null)).toBe(false);
    expect(isSameAddress(undefined, A)).toBe(false);
    expect(isSameAddress("", A)).toBe(false);
  });
});
