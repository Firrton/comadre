import { describe, it, expect } from "bun:test";
import { assertPrivySolanaCapability } from "../privySigner";

describe("privySigner capability check", () => {
  it("does not throw when @privy-io/server-auth >= 1.32.5 is installed", () => {
    // The test env has the right SDK version pinned via bun.lock; this just
    // confirms the surface is reachable. Failure here means the SDK shape
    // changed in a breaking way.
    expect(() => assertPrivySolanaCapability()).not.toThrow();
  });
});
