import { createPublicClient, http, type Address } from "viem";
import { createKernelAccount } from "@zerodev/sdk";
import { getEntryPoint, KERNEL_V3_1 } from "@zerodev/sdk/constants";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import { monadTestnet } from "../chains.js";

/**
 * Returns the counterfactual address of the Kernel v3.1 smart wallet for a
 * given owner EOA (Privy embedded wallet). The wallet does NOT exist on-chain
 * yet — it will be deployed at the first UserOp by the bundler's factory call.
 *
 * Lazy deployment is the v1 default per docs/WALLET_SECURITY.md §13.
 */
export interface CounterfactualInput {
  /** EIP-1193 provider OR a viem LocalAccount (e.g. server-side throwaway in tests). */
  ownerSigner: unknown;
  /** RPC URL — defaults to Monad testnet. */
  rpcUrl?: string;
}

export async function counterfactualSmartWalletAddress(
  input: CounterfactualInput,
): Promise<Address> {
  const publicClient = createPublicClient({
    chain: monadTestnet,
    transport: http(input.rpcUrl ?? monadTestnet.rpcUrls.default.http[0]),
  });
  const entryPoint = getEntryPoint("0.7");

  const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
    signer: input.ownerSigner as Parameters<typeof signerToEcdsaValidator>[1]["signer"],
    entryPoint,
    kernelVersion: KERNEL_V3_1,
  });

  const account = await createKernelAccount(publicClient, {
    entryPoint,
    plugins: { sudo: ecdsaValidator },
    kernelVersion: KERNEL_V3_1,
  });

  return account.address;
}
