import { createPublicClient, http, type Address } from "viem";
import { addressToEmptyAccount, createKernelAccount } from "@zerodev/sdk";
import { getEntryPoint, KERNEL_V3_1 } from "@zerodev/sdk/constants";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import { serializePermissionAccount, toPermissionValidator } from "@zerodev/permissions";
import { toECDSASigner } from "@zerodev/permissions/signers";

import { monadTestnet } from "../chains.js";
import { buildDailyPolicies, buildElevatedPolicies, type NeverlandParams } from "./policies.js";

/**
 * Client-side approval flow — runs in the user's browser during onboarding.
 *
 * The Privy embedded wallet (the OWNER) signs the install of the session key
 * plugin and produces a serialized blob. The blob is shipped to the backend,
 * which combines it with the `sessionPrivateKey` (also produced server-side
 * and known only to the backend) under AES-GCM at rest.
 *
 * This implements "Pattern A" from docs/WALLET_SECURITY.md — the private key
 * never enters the browser.
 *
 * NOTE: this file imports from `@zerodev/*` which is fine on the client.
 * It is included in `packages/wallet-infra` so the API of approval is
 * documented in TypeScript next to the server-side decode path.
 */

export interface ApproveSessionKeyInput {
  /** EIP-1193 provider from `embeddedWallet.getEthereumProvider()` (Privy). */
  privyProvider: unknown;
  /** Address of the session key the backend generated and sent down. */
  sessionAddress: Address;
  /** Deployed Comadre contract on Monad (testnet or mainnet). */
  comadreAddress: Address;
  /** Deployed USDC contract on Monad. */
  usdcAddress: Address;
  /** "daily" or "elevated" — selects the policy preset. */
  kind: "daily" | "elevated";
  /** RPC URL — defaults to monadTestnet default if omitted. */
  rpcUrl?: string;
  /**
   * Neverland yield integration — when provided the session key gains policies
   * for USDC.approve(pool), Pool.supply, Pool.withdraw, and fee transfer.
   * Omit when Neverland env vars are not configured (dev / non-yield flows).
   */
  neverlandParams?: NeverlandParams;
}

export interface ApproveSessionKeyResult {
  /** Serialized permission-account blob — opaque base64-ish string. POST to backend. */
  serializedBlob: string;
  /** Smart wallet's counterfactual address (deterministic from owner + factory). */
  smartWalletAddress: Address;
}

export async function approveSessionKey(
  input: ApproveSessionKeyInput,
): Promise<ApproveSessionKeyResult> {
  const publicClient = createPublicClient({
    chain: monadTestnet,
    transport: http(input.rpcUrl ?? monadTestnet.rpcUrls.default.http[0]),
  });
  const entryPoint = getEntryPoint("0.7");

  // 1. Build the owner's ECDSA validator from the Privy EIP-1193 provider.
  //    `signerToEcdsaValidator` overload accepts a provider directly — do NOT
  //    convert to a viem LocalAccount manually; the validator does that internally.
  const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
    signer: input.privyProvider as Parameters<typeof signerToEcdsaValidator>[1]["signer"],
    entryPoint,
    kernelVersion: KERNEL_V3_1,
  });

  // 2. Build the placeholder permission plugin — the session signer is constructed
  //    from `addressToEmptyAccount` so the owner can sign the enable without ever
  //    seeing the session private key.
  const emptyAccount = addressToEmptyAccount(input.sessionAddress);
  const emptySessionSigner = await toECDSASigner({ signer: emptyAccount });

  const policies =
    input.kind === "daily"
      ? buildDailyPolicies(input.comadreAddress, input.usdcAddress, input.neverlandParams)
      : buildElevatedPolicies(input.comadreAddress, input.usdcAddress, input.neverlandParams);

  const permissionPlugin = await toPermissionValidator(publicClient, {
    entryPoint,
    signer: emptySessionSigner,
    policies,
    kernelVersion: KERNEL_V3_1,
  });

  // 3. Compose the account with sudo = owner, regular = permission plugin.
  //    Creating this also yields the counterfactual smart-wallet address.
  const sessionKeyAccount = await createKernelAccount(publicClient, {
    entryPoint,
    plugins: { sudo: ecdsaValidator, regular: permissionPlugin },
    kernelVersion: KERNEL_V3_1,
  });

  // 4. Serialize WITHOUT embedding the private key (Pattern A).
  const serializedBlob = await serializePermissionAccount(sessionKeyAccount);

  return {
    serializedBlob,
    smartWalletAddress: sessionKeyAccount.address,
  };
}
