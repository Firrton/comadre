import { createPublicClient, encodeFunctionData, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createKernelAccountClient } from "@zerodev/sdk";
import { getEntryPoint, KERNEL_V3_1 } from "@zerodev/sdk/constants";
import { deserializePermissionAccount } from "@zerodev/permissions";
import { toECDSASigner } from "@zerodev/permissions/signers";

import { decryptSessionKey } from "../kms/client.js";
import { monadTestnet } from "../chains.js";
import { loadWalletInfraEnv, pimlicoBundlerUrl } from "../config.js";
import type { SessionKeyCiphertext } from "../types.js";

export interface SignAndSendInput {
  envelope: SessionKeyCiphertext;
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
 * The single security-critical entry point: decrypt → deserialize → sign → bundle.
 *
 * Failure modes — all caught and surfaced upstream:
 *   - decrypt fail   → KMS denied / key rotated / DB row tampered
 *   - deserialize fail → blob corrupted / encryption version mismatch
 *   - sendUserOperation fail → policy rejected the call (best case) or bundler is down
 *
 * Caller is responsible for pre-checking allowedRecipients / amount caps against the
 * `policiesJson` digest in the DB row BEFORE invoking this function. Don't call KMS
 * to discover that the user wanted to transfer more than the daily cap allows.
 */
export async function signAndSendUserOp(input: SignAndSendInput): Promise<SignAndSendResult> {
  const env = loadWalletInfraEnv();

  const publicClient = createPublicClient({
    chain: monadTestnet,
    transport: http(env.MONAD_RPC_URL),
  });
  const entryPoint = getEntryPoint("0.7");

  const plaintext = await decryptSessionKey(input.envelope);

  const sessionKeySigner = await toECDSASigner({
    signer: privateKeyToAccount(plaintext.sessionPrivateKey),
  });

  const sessionKeyAccount = await deserializePermissionAccount(
    publicClient,
    entryPoint,
    KERNEL_V3_1,
    plaintext.blob,
    sessionKeySigner,
  );

  const bundlerUrl =
    input.bundlerUrlOverride ?? pimlicoBundlerUrl(env.MONAD_CHAIN_ID, env.PIMLICO_API_KEY);

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
  envelope: SessionKeyCiphertext;
  to: Address;
  abi: TAbi;
  functionName: TFunctionName;
  args: readonly unknown[];
  value?: bigint;
}): Promise<SignAndSendResult> {
  const data = encodeFunctionData({
    abi: args.abi,
    functionName: args.functionName,
    args: args.args,
  } as Parameters<typeof encodeFunctionData>[0]) as Hex;

  return signAndSendUserOp({
    envelope: args.envelope,
    to: args.to,
    data,
    value: args.value,
  });
}
