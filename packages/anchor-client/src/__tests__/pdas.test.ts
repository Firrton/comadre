import { describe, it, expect } from "bun:test";
import { PublicKey } from "@solana/web3.js";
import {
  deriveConfigPda,
  deriveUserProfilePda,
  deriveTandaPda,
  deriveMemberPda,
  deriveVaultPda,
  deriveDisputePda,
  deriveDisputeVotePda,
} from "../pdas";

describe("PDA derivation", () => {
  it("Config PDA is deterministic across calls", () => {
    const [a, bumpA] = deriveConfigPda();
    const [b, bumpB] = deriveConfigPda();
    expect(a.equals(b)).toBe(true);
    expect(bumpA).toBe(bumpB);
  });

  it("UserProfile PDA differs per wallet", () => {
    const w1 = PublicKey.unique();
    const w2 = PublicKey.unique();
    const [pda1] = deriveUserProfilePda(w1);
    const [pda2] = deriveUserProfilePda(w2);
    expect(pda1.equals(pda2)).toBe(false);
  });

  it("Tanda PDA differs per tanda_id (same creator)", () => {
    const creator = PublicKey.unique();
    const [a] = deriveTandaPda(creator, 0n);
    const [b] = deriveTandaPda(creator, 1n);
    const [c] = deriveTandaPda(creator, 2n ** 63n);
    expect(a.equals(b)).toBe(false);
    expect(b.equals(c)).toBe(false);
  });

  it("Member PDA combines tanda + user", () => {
    const tanda = PublicKey.unique();
    const u1 = PublicKey.unique();
    const u2 = PublicKey.unique();
    const [a] = deriveMemberPda(tanda, u1);
    const [b] = deriveMemberPda(tanda, u2);
    expect(a.equals(b)).toBe(false);
  });

  it("Vault PDA derives a valid address with bump", () => {
    const tanda = PublicKey.unique();
    const [vault, bump] = deriveVaultPda(tanda);
    expect(vault).toBeInstanceOf(PublicKey);
    expect(bump).toBeGreaterThanOrEqual(0);
    expect(bump).toBeLessThan(256);
  });

  it("Dispute PDA rejects out-of-range disputeId", () => {
    const tanda = PublicKey.unique();
    expect(() => deriveDisputePda(tanda, -1)).toThrow(RangeError);
    expect(() => deriveDisputePda(tanda, 256)).toThrow(RangeError);
    expect(() => deriveDisputePda(tanda, 1.5)).toThrow(RangeError);
  });

  it("Dispute PDA differs per dispute_id", () => {
    const tanda = PublicKey.unique();
    const [a] = deriveDisputePda(tanda, 0);
    const [b] = deriveDisputePda(tanda, 1);
    expect(a.equals(b)).toBe(false);
  });

  it("DisputeVote PDA combines dispute + voter", () => {
    const dispute = PublicKey.unique();
    const v1 = PublicKey.unique();
    const v2 = PublicKey.unique();
    const [a] = deriveDisputeVotePda(dispute, v1);
    const [b] = deriveDisputeVotePda(dispute, v2);
    expect(a.equals(b)).toBe(false);
  });
});
