import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { aesGcmDecrypt, aesGcmEncrypt, constantTimeEqual, zeroize } from "./aesGcm.js";

describe("aesGcmEncrypt / aesGcmDecrypt", () => {
  test("round-trips a short utf-8 string", () => {
    const dek = randomBytes(32);
    const plaintext = "the quick brown fox jumps over the lazy dog";
    const enc = aesGcmEncrypt(plaintext, dek);
    const dec = aesGcmDecrypt(enc, dek);
    expect(dec.toString("utf8")).toBe(plaintext);
  });

  test("round-trips a session-key-sized payload (~ 1.5KB JSON)", () => {
    const dek = randomBytes(32);
    const fakeBlob = "x".repeat(1500);
    const payload = JSON.stringify({
      blob: fakeBlob,
      sessionPrivateKey: `0x${"ab".repeat(32)}`,
    });
    const enc = aesGcmEncrypt(payload, dek);
    const dec = aesGcmDecrypt(enc, dek);
    expect(dec.toString("utf8")).toBe(payload);
  });

  test("round-trips a binary buffer", () => {
    const dek = randomBytes(32);
    const plaintext = randomBytes(64);
    const enc = aesGcmEncrypt(plaintext, dek);
    const dec = aesGcmDecrypt(enc, dek);
    expect(constantTimeEqual(dec, plaintext)).toBe(true);
  });

  test("produces a fresh IV each call (probabilistic)", () => {
    const dek = randomBytes(32);
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const enc = aesGcmEncrypt("same input", dek);
      seen.add(enc.iv);
    }
    expect(seen.size).toBe(50);
  });

  test("rejects DEK of wrong length (encrypt)", () => {
    const dek = randomBytes(16);
    expect(() => aesGcmEncrypt("x", dek)).toThrow(/DEK must be exactly 32 bytes/);
  });

  test("rejects DEK of wrong length (decrypt)", () => {
    const dek = randomBytes(32);
    const enc = aesGcmEncrypt("x", dek);
    expect(() => aesGcmDecrypt(enc, randomBytes(16))).toThrow(/DEK must be exactly 32 bytes/);
  });

  test("detects ciphertext tampering (modified byte)", () => {
    const dek = randomBytes(32);
    const enc = aesGcmEncrypt("important", dek);
    const raw = Buffer.from(enc.ciphertext, "base64");
    raw[0] = raw[0]! ^ 0xff;
    const tampered = { ...enc, ciphertext: raw.toString("base64") };
    expect(() => aesGcmDecrypt(tampered, dek)).toThrow();
  });

  test("detects ciphertext tampering (modified auth tag)", () => {
    const dek = randomBytes(32);
    const enc = aesGcmEncrypt("important", dek);
    const raw = Buffer.from(enc.ciphertext, "base64");
    raw[raw.length - 1] = raw[raw.length - 1]! ^ 0xff;
    const tampered = { ...enc, ciphertext: raw.toString("base64") };
    expect(() => aesGcmDecrypt(tampered, dek)).toThrow();
  });

  test("detects wrong DEK", () => {
    const dek1 = randomBytes(32);
    const dek2 = randomBytes(32);
    const enc = aesGcmEncrypt("secret", dek1);
    expect(() => aesGcmDecrypt(enc, dek2)).toThrow();
  });

  test("detects malformed IV length", () => {
    const dek = randomBytes(32);
    const enc = aesGcmEncrypt("x", dek);
    const badIv = { ...enc, iv: randomBytes(8).toString("base64") };
    expect(() => aesGcmDecrypt(badIv, dek)).toThrow(/IV must be exactly 12 bytes/);
  });

  test("zeroize wipes a buffer", () => {
    const buf = Buffer.from("sensitive data");
    zeroize(buf);
    for (const byte of buf) expect(byte).toBe(0);
  });

  test("constantTimeEqual returns false for different lengths", () => {
    expect(constantTimeEqual(Buffer.from("abc"), Buffer.from("abcd"))).toBe(false);
  });
});
