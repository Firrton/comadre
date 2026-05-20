import { createPublicClient, http, type Address, type Hex } from "viem";
import { createKernelAccountClient } from "@zerodev/sdk";
import { getEntryPoint, KERNEL_V3_1 } from "@zerodev/sdk/constants";
import { deserializePermissionAccount } from "@zerodev/permissions";
import { toECDSASigner } from "@zerodev/permissions/signers";
import { createAccount } from "@turnkey/viem";

import { getTurnkeyClient } from "../turnkey/client.js";
import { monadTestnet } from "../chains.js";
import { loadWalletInfraEnv, pimlicoBundlerUrl } from "../config.js";

export interface SignAndSendInput {
  /** Turnkey sub-organization ID that owns the agent wallet. */
  subOrgId: string;
  /** Wallet ID (or address) within the sub-org to sign with. */
  walletId: string;
  /** ZeroDev serialized permission blob (from DB serializedPermission column). */
  serializedPermissionBlob: string;
  to: Address;
  data: Hex;
  /** Native MON value to send with the call. Default 0. */
  value?: bigint;
  /** Optional viem-style override for the bundler URL, primarily for tests. */
  bundlerUrlOverride?: string;
}

export interface SignAndSendResult {
  userOpHash: Hex;
  txHash: Hex;
}

/**
 * The single security-critical entry point: Turnkey sign → deserialize → bundle.
 *
 * Uses Turnkey as the key custodian instead of KMS. The session private key never
 * leaves Turnkey — we construct a viem wallet client backed by Turnkey and use it
 * as the ECDSA signer for ZeroDev's permission account.
 *
 * Failure modes — all caught and surfaced upstream:
 *   - Turnkey sign fail  → policy rejected / org not found / key not authorized
 *   - deserialize fail   → blob corrupted / permission version mismatch
 *   - sendUserOperation fail → on-chain policy rejected the call or bundler is down
 *
 * Caller is responsible for pre-checking allowedRecipients / amount caps BEFORE
 * invoking this function.
 */
export async function signAndSendUserOp(input: SignAndSendInput): Promise<SignAndSendResult> {
  const walletInfraEnv = loadWalletInfraEnv();

  const publicClient = createPublicClient({
    chain: monadTestnet,
    transport: http(walletInfraEnv.MONAD_RPC_URL),
  });
  const entryPoint = getEntryPoint("0.7");

  // Build a Turnkey-backed viem LocalAccount for the agent wallet.
  // createAccount returns a LocalAccount that implements signMessage/signTransaction.
  // We then wrap it with toECDSASigner to satisfy ZeroDev's ModularSigner interface.
  const tk = getTurnkeyClient();
  const turnkeyAccount = await createAccount({
    client: tk.apiClient(),
    organizationId: input.subOrgId,
    signWith: input.walletId,
  });

  const ecdsaSigner = await toECDSASigner({ signer: turnkeyAccount });

  const sessionKeyAccount = await deserializePermissionAccount(
    publicClient,
    entryPoint,
    KERNEL_V3_1,
    input.serializedPermissionBlob,
    ecdsaSigner,
  );

  const bundlerUrl =
    input.bundlerUrlOverride ?? pimlicoBundlerUrl(walletInfraEnv.MONAD_CHAIN_ID, walletInfraEnv.PIMLICO_API_KEY);

  const kernelClient = createKernelAccountClient({
    account: sessionKeyAccount,
    chain: monadTestnet,
    bundlerTransport: http(bundlerUrl),
    // Pimlico paymaster wiring is optional — uncomment if PIMLICO_PAYMASTER_ENABLED.
    // See ZeroDev docs for the exact getPaymasterData callback shape.
  });

  const callData = await sessionKeyAccount.encodeCalls([
    { to: input.to, data: input.data, value: input.value ?? 0n },
  ]);

  const userOpHash = await kernelClient.sendUserOperation({ callData });

  // 5-minute timeout — Monad blocks are fast but bundler bundling is paced.
  const receipt = await kernelClient.waitForUserOperationReceipt({
    hash: userOpHash,
    timeout: 1000 * 60 * 5,
  });

  return {
    userOpHash,
    txHash: receipt.receipt.transactionHash,
  };
}

/** Convenience: build calldata for a typed contract call and dispatch. */
export async function signAndSendContractCall<
  TAbi extends readonly unknown[],
  TFunctionName extends string,
>(args: {
  subOrgId: string;
  walletId: string;
  serializedPermissionBlob: string;
  to: Address;
  abi: TAbi;
  functionName: TFunctionName;
  args: readonly unknown[];
  value?: bigint;
}): Promise<SignAndSendResult> {
  const { encodeFunctionData } = await import("viem");
  const data = encodeFunctionData({
    abi: args.abi,
    functionName: args.functionName,
    args: args.args,
  } as Parameters<typeof encodeFunctionData>[0]) as Hex;

  return signAndSendUserOp({
    subOrgId: args.subOrgId,
    walletId: args.walletId,
    serializedPermissionBlob: args.serializedPermissionBlob,
    to: args.to,
    data,
    value: args.value,
  });
}
