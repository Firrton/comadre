/**
 * Server-side signer that signs a UserOperation on behalf of a user using
 * their daily Kernel session key. Decrypts via AWS KMS, builds the call,
 * submits through Pimlico, returns the receipt.
 *
 * Pre-conditions (caller's responsibility):
 *   - The session key row in DB is `active` and not expired.
 *   - `amountMicroUsdc` is within `perCallCapMicroUsdc` for that session key.
 *   - The target contract is in the session key's `allowedContracts` list
 *     (or accepted via OOB confirmation flow for elevated session keys).
 */

import { and, eq, gt } from "drizzle-orm";
import { db, sessionKeys, smartWallets } from "@comadre/db";
import { kms, sessionKey as sessionKeyApi } from "@comadre/wallet-infra";
import type { Address, Hex } from "viem";

export interface SignMonadTransferInput {
  smartWalletAddress: Address;
  to: Address;
  data: Hex;
  amountMicroUsdc: bigint;
}

export type SignMonadTransferResult =
  | { ok: true; userOpHash: Hex; txHash: Hex }
  | { ok: false; reason: "no_session" | "cap_exceeded" | "wallet_not_found" };

export async function signMonadTransfer(
  input: SignMonadTransferInput,
): Promise<SignMonadTransferResult> {
  const walletRows = await db
    .select()
    .from(smartWallets)
    .where(eq(smartWallets.smartWalletAddress, input.smartWalletAddress.toLowerCase()))
    .limit(1);

  const wallet = walletRows[0];
  if (!wallet) return { ok: false, reason: "wallet_not_found" };

  const keyRows = await db
    .select()
    .from(sessionKeys)
    .where(
      and(
        eq(sessionKeys.smartWalletId, wallet.id),
        eq(sessionKeys.kind, "daily"),
        eq(sessionKeys.status, "active"),
        gt(sessionKeys.validUntil, new Date()),
      ),
    )
    .limit(1);

  const key = keyRows[0];
  if (!key) return { ok: false, reason: "no_session" };

  if (input.amountMicroUsdc > key.perCallCapMicroUsdc) {
    return { ok: false, reason: "cap_exceeded" };
  }

  const plaintext = await kms.decryptSessionKey({
    ciphertext: key.ciphertext,
    dekCiphertext: key.dekCiphertext,
    iv: key.iv,
    encryptionVersion: key.encryptionVersion,
  });

  const result = await sessionKeyApi.signAndSendUserOp({
    envelope: {
      ciphertext: key.ciphertext,
      dekCiphertext: key.dekCiphertext,
      iv: key.iv,
      encryptionVersion: key.encryptionVersion,
    },
    to: input.to,
    data: input.data,
  });

  // Touch lastUsedAt for observability + future rate-limit policies.
  await db
    .update(sessionKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(sessionKeys.id, key.id));

  // Avoid retaining the plaintext reference in any closure scope.
  void plaintext;

  return { ok: true, userOpHash: result.userOpHash, txHash: result.txHash };
}
