import { createPublicClient, http, type Address } from "viem";
import { addressToEmptyAccount, createKernelAccount, createKernelAccountClient } from "@zerodev/sdk";
import { getEntryPoint, KERNEL_V3_1 } from "@zerodev/sdk/constants";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import { toPermissionValidator } from "@zerodev/permissions";
import { toECDSASigner } from "@zerodev/permissions/signers";

import { monadTestnet } from "../chains.js";
import { loadWalletInfraEnv, pimlicoBundlerUrl } from "../config.js";
import { buildDailyPolicies, buildElevatedPolicies } from "./policies.js";

/**
 * On-chain revocation of a session key. Requires the OWNER's signature
 * (Privy embedded wallet) — call this only after re-authenticating the user
 * through Privy.
 *
 * In practice this is rarely needed: deleting the encrypted blob from the DB
 * is sufficient to render the session key inert. Use this path only when the
 * on-chain validator must be uninstalled (e.g. policy upgrade with same
 * permissionId, or extreme caution).
 */
export interface RevokeOnChainInput {
  privyProvider: unknown;
  sessionAddress: Address;
  comadreAddress: Address;
  usdcAddress: Address;
  kind: "daily" | "elevated";
}

export async function revokeSessionKeyOnChain(input: RevokeOnChainInput): Promise<{ userOpHash: `0x${string}` }> {
  const env = loadWalletInfraEnv();

  const publicClient = createPublicClient({
    chain: monadTestnet,
    transport: http(env.MONAD_RPC_URL),
  });
  const entryPoint = getEntryPoint("0.7");

  const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
    signer: input.privyProvider as Parameters<typeof signerToEcdsaValidator>[1]["signer"],
    entryPoint,
    kernelVersion: KERNEL_V3_1,
  });

  // Rebuild the same plugin from public data — no private key needed.
  const emptyAccount = addressToEmptyAccount(input.sessionAddress);
  const emptySessionSigner = await toECDSASigner({ signer: emptyAccount });

  const policies =
    input.kind === "daily"
      ? buildDailyPolicies(input.comadreAddress, input.usdcAddress)
      : buildElevatedPolicies(input.comadreAddress, input.usdcAddress);

  const permissionPlugin = await toPermissionValidator(publicClient, {
    entryPoint,
    signer: emptySessionSigner,
    policies,
    kernelVersion: KERNEL_V3_1,
  });

  // Build the OWNER-only kernel client (no regular plugin) so the uninstall
  // is signed by the sudo validator.
  const sudoAccount = await createKernelAccount(publicClient, {
    entryPoint,
    plugins: { sudo: ecdsaValidator },
    kernelVersion: KERNEL_V3_1,
  });

  const sudoClient = createKernelAccountClient({
    account: sudoAccount,
    chain: monadTestnet,
    bundlerTransport: http(pimlicoBundlerUrl(env.MONAD_CHAIN_ID, env.PIMLICO_API_KEY)),
  });

  const userOpHash = await sudoClient.uninstallPlugin({ plugin: permissionPlugin });
  return { userOpHash };
}
