import type { Address, Hex } from "viem";

/**
 * Two kinds of session keys per smart wallet:
 *  - "daily": low-cap (50 USDC), high rate-limit. Used by the agent for normal ops.
 *  - "elevated": higher-cap (1000 USDC), strict rate-limit. Decrypted only after
 *    fresh Twilio Verify OTP check passes.
 */
export type SessionKeyKind = "daily" | "elevated";

export type SessionKeyStatus = "active" | "expired" | "revoked";

/** What a session key is permitted to call. Stored in DB for fast pre-checks before KMS decryption. */
export interface SessionKeyPolicyDigest {
  perCallCapMicroUsdc: bigint;
  allowedContracts: Address[];
  allowedRecipients: Address[];
  validUntil: Date;
  /** seconds */
  rateLimitInterval: number;
  /** ops per interval */
  rateLimitCount: number;
}

/**
 * Encrypted session-key envelope as persisted in DB.
 *
 * `ciphertext` = AES-256-GCM( JSON.stringify({ blob, sessionPrivateKey }), DEK, iv )
 * `dekCiphertext` = KMS-encrypted DEK (envelope encryption — KMS unwraps at decrypt time)
 * `iv` = 12-byte AES-GCM IV
 *
 * All three are base64 strings.
 */
export interface SessionKeyCiphertext {
  ciphertext: string;
  dekCiphertext: string;
  iv: string;
  encryptionVersion: string;
}

/** Plaintext of a session-key envelope after decryption. Never persisted to disk. */
export interface SessionKeyPlaintext {
  /** The ZeroDev `serializePermissionAccount` blob. */
  blob: string;
  /** secp256k1 private key (0x-prefixed 32-byte hex). */
  sessionPrivateKey: Hex;
}

export interface SmartWalletRow {
  id: string;
  userId: string;
  privyUserId: string;
  ownerAddress: Address;
  smartWalletAddress: Address;
  chainId: number;
  kernelVersion: "v3.1";
  deployedOnChain: boolean;
}
