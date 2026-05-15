import { PrivyClient } from "@privy-io/server-auth";
import type { Address } from "viem";

let _privy: PrivyClient | null = null;

function getPrivy(): PrivyClient {
  if (_privy !== null) return _privy;
  const appId = process.env["PRIVY_APP_ID"];
  const appSecret = process.env["PRIVY_APP_SECRET"];
  if (!appId || !appSecret) {
    throw new Error("[wallet-infra/privy] PRIVY_APP_ID and PRIVY_APP_SECRET are required");
  }
  _privy = new PrivyClient(appId, appSecret);
  return _privy;
}

export interface VerifiedPrivyClaims {
  userId: string;
  /** Lowercased hex EVM address of the user's embedded wallet, if present. */
  ownerAddress: Address | null;
  /** Phone numbers linked to the Privy user (E.164 if present). */
  phoneNumbers: string[];
}

/**
 * Verify a Privy JWT and extract the embedded EVM wallet address + phone.
 *
 * Used by the onboarding callback to confirm the user just authenticated and
 * to read the freshly-created embedded EVM wallet's address before computing
 * the counterfactual smart-wallet address.
 */
export async function verifyPrivyJwt(token: string): Promise<VerifiedPrivyClaims> {
  const privy = getPrivy();
  const claims = await privy.verifyAuthToken(token);

  const linkedAccounts = (claims as unknown as {
    linkedAccounts?: Array<{ type?: string; address?: string; chainType?: string; phoneNumber?: string }>;
  }).linkedAccounts ?? [];

  // Find the first EVM embedded wallet.
  const evmWallet = linkedAccounts.find(
    (a) => a.type === "wallet" && a.chainType === "ethereum" && typeof a.address === "string",
  );
  const phones = linkedAccounts
    .filter((a) => a.type === "phone" && typeof a.phoneNumber === "string")
    .map((a) => a.phoneNumber as string);

  return {
    userId: claims.userId,
    ownerAddress: evmWallet?.address ? (evmWallet.address.toLowerCase() as Address) : null,
    phoneNumbers: phones,
  };
}
