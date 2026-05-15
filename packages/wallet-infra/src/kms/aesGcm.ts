import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

/**
 * AES-256-GCM helpers wrapping a 32-byte Data Encryption Key (DEK).
 *
 * Layout of the persisted ciphertext (base64):
 *   [ciphertext || authTag]
 *
 * The IV is stored separately. The auth tag is appended to the ciphertext on
 * encrypt; we slice it off on decrypt before passing to the cipher.
 *
 * The caller is responsible for zeroizing the DEK after use.
 */

export interface AesGcmEncrypted {
  /** ciphertext || authTag, base64 */
  ciphertext: string;
  /** 12-byte IV, base64 */
  iv: string;
}

export function aesGcmEncrypt(plaintext: Buffer | string, dek: Buffer): AesGcmEncrypted {
  if (dek.byteLength !== KEY_BYTES) {
    throw new Error(`[aesGcm] DEK must be exactly ${KEY_BYTES} bytes, got ${dek.byteLength}`);
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, dek, iv);
  const data = typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : plaintext;
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([encrypted, authTag]).toString("base64"),
    iv: iv.toString("base64"),
  };
}

export function aesGcmDecrypt(input: AesGcmEncrypted, dek: Buffer): Buffer {
  if (dek.byteLength !== KEY_BYTES) {
    throw new Error(`[aesGcm] DEK must be exactly ${KEY_BYTES} bytes, got ${dek.byteLength}`);
  }
  const raw = Buffer.from(input.ciphertext, "base64");
  if (raw.byteLength < AUTH_TAG_BYTES) {
    throw new Error("[aesGcm] ciphertext too short to contain auth tag");
  }
  const data = raw.subarray(0, raw.byteLength - AUTH_TAG_BYTES);
  const authTag = raw.subarray(raw.byteLength - AUTH_TAG_BYTES);
  const iv = Buffer.from(input.iv, "base64");
  if (iv.byteLength !== IV_BYTES) {
    throw new Error(`[aesGcm] IV must be exactly ${IV_BYTES} bytes, got ${iv.byteLength}`);
  }
  const decipher = createDecipheriv(ALGORITHM, dek, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

/**
 * Constant-time equality check for sensitive comparisons (e.g. tag verification).
 * Returns false if lengths differ — does not throw.
 */
export function constantTimeEqual(a: Buffer, b: Buffer): boolean {
  if (a.byteLength !== b.byteLength) return false;
  return timingSafeEqual(a, b);
}

/** Best-effort zeroize. JS strings are immutable; only useful for Buffer-backed DEKs. */
export function zeroize(buf: Buffer): void {
  buf.fill(0);
}
