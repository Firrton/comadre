import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";

export interface GeneratedSessionKey {
  privateKey: Hex;
  address: Address;
}

/**
 * Mint a fresh secp256k1 keypair for use as a ZeroDev session signer.
 *
 * The private key is returned to the caller exactly once. Persist it
 * via `encryptSessionKey` immediately and zero out the reference in memory.
 */
export function generateSessionKey(): GeneratedSessionKey {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return { privateKey, address: account.address };
}
