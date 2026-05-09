import { describe, it, expect } from "bun:test";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { getFeePayerKeypair, _resetKeypairCache } from "../feePayer";

describe("keypair loading", () => {
  it("loads the FEE_PAYER_SK from env as a valid Keypair", () => {
    _resetKeypairCache();
    const kp = getFeePayerKeypair();
    // The pubkey is derived from the env's FEE_PAYER_SK; we just verify the shape.
    expect(kp).toBeInstanceOf(Keypair);
    expect(kp.publicKey).toBeDefined();
    expect(kp.secretKey.length).toBe(64);

    // Sanity-check: the loaded pubkey matches what bs58-decoding the env var produces.
    const expectedSecret = bs58.decode(process.env.FEE_PAYER_SK ?? "");
    const expectedPubkey = Keypair.fromSecretKey(expectedSecret).publicKey.toBase58();
    expect(kp.publicKey.toBase58()).toBe(expectedPubkey);
  });

  it("caches keypairs across calls", () => {
    _resetKeypairCache();
    const a = getFeePayerKeypair();
    const b = getFeePayerKeypair();
    expect(a).toBe(b);
  });
});
