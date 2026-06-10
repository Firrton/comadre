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
import { evaluateRecipient } from "./recipientPolicy.js";

export interface SignMonadTransferInput {
  smartWalletAddress: Address;
  to: Address;
  data: Hex;
  amountMicroUsdc: bigint;
}

export type SignMonadTransferResult =
  | { ok: true; userOpHash: Hex; txHash: Hex }
  | {
      ok: false;
      reason:
        | "no_session"
        | "cap_exceeded"
        | "wallet_not_found"
        | "recipient_not_allowed"
        | "undecodable_calldata";
    };

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

  // COM-004: allowlist enforcement, FAIL-CLOSED. Same decision function as
  // the route layer (evaluateRecipient): an empty allowlist denies every
  // transfer, and calldata that does not decode as USDC transfer(to, amount)
  // is rejected outright — this signer signs nothing else. The confirmation
  // flow appends the recipient BEFORE signing (transfersMonad), so a
  // legitimate first send never reaches the signer unconfirmed. Last line of
  // defense for any caller that bypasses the route-level gate.
  const recipientCheck = evaluateRecipient(
    key.allowedRecipients as string[],
    input.data,
  );
  if (!recipientCheck.ok) {
    return { ok: false, reason: recipientCheck.reason };
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
