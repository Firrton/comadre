/**
 * Server-side signer that signs a UserOperation on behalf of a user using
 * their daily Kernel session key. Signs via Turnkey, builds the call,
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
import { sessionKey as sessionKeyApi } from "@comadre/wallet-infra";
import type { Address, Hex } from "viem";
import { decodeUsdcTransferCalldata } from "./monadUsdcTransfer.js";

export interface SignMonadTransferInput {
  smartWalletAddress: Address;
  to: Address;
  data: Hex;
  amountMicroUsdc: bigint;
}

export type SignMonadTransferResult =
  | { ok: true; userOpHash: Hex; txHash: Hex }
  | { ok: false; reason: "no_session" | "cap_exceeded" | "wallet_not_found" | "recipient_not_allowed" };

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
    .select({
      id: sessionKeys.id,
      perCallCapMicroUsdc: sessionKeys.perCallCapMicroUsdc,
      allowedContracts: sessionKeys.allowedContracts,
      allowedRecipients: sessionKeys.allowedRecipients,
      turnkeySubOrgId: sessionKeys.turnkeySubOrgId,
      turnkeyWalletId: sessionKeys.turnkeyWalletId,
      serializedPermission: sessionKeys.serializedPermission,
    })
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

  // COM-004: allowlist enforcement — decode the USDC transfer(to, amount) calldata
  // and reject if the recipient is not in the user's contact allowlist.
  // Phase 1: empty allowlist = no enforcement (contacts are added post-onboarding).
  const decoded = decodeUsdcTransferCalldata(input.data);
  if (decoded) {
    const allowedRecipients = key.allowedRecipients as string[];
    if (allowedRecipients.length > 0) {
      const recipientLower = decoded.to.toLowerCase();
      const allowed = allowedRecipients.map((r) => r.toLowerCase());
      if (!allowed.includes(recipientLower)) {
        return { ok: false, reason: "recipient_not_allowed" };
      }
    }
  }

  const result = await sessionKeyApi.signAndSendUserOp({
    subOrgId: key.turnkeySubOrgId,
    walletId: key.turnkeyWalletId,
    serializedPermissionBlob: key.serializedPermission,
    to: input.to,
    data: input.data,
  });

  await db
    .update(sessionKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(sessionKeys.id, key.id));

  return { ok: true, userOpHash: result.userOpHash, txHash: result.txHash };
}
