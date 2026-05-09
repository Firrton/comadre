/**
 * Build a partially-signed `VersionedTransaction` ready for the user's client
 * to add their signature and broadcast.
 *
 * The backend ALWAYS pre-signs with the fee_payer (and optionally additional
 * backend signers like `crank_authority` for cron txs). The caller side only
 * needs the user's signature for instructions where the user is required.
 *
 * Output is base64 so it can be stuffed in a JSON response and later
 * deserialized client-side via `VersionedTransaction.deserialize(Buffer.from(b64, "base64"))`.
 */
import {
  ComputeBudgetProgram,
  TransactionMessage,
  VersionedTransaction,
  type Connection,
  type Keypair,
  type TransactionInstruction,
} from "@solana/web3.js";
import { getConnection } from "./connection";
import { getFeePayerKeypair } from "./feePayer";
import { getPriorityFeeMicroLamports, type PriorityLevel } from "./priorityFee";

export interface BuildUnsignedTxParams {
  /** Anchor instructions to wrap. Order is preserved. */
  instructions: TransactionInstruction[];
  /** Override the fee payer. Defaults to the FEE_PAYER from env. */
  payer?: Keypair;
  /** Additional backend signers (e.g. crank_authority for crank txs). */
  signers?: Keypair[];
  /** Compute unit limit. Default 200_000 (most ixs need < 100k). */
  computeUnits?: number;
  /** Helius priority level. Default `"Medium"`. */
  priorityLevel?: PriorityLevel;
  /** Override Connection (useful in tests). */
  connection?: Connection;
}

export interface UnsignedTxResult {
  /** Base64-encoded `VersionedTransaction.serialize()`, partially signed by backend. */
  unsignedTxBase64: string;
  /** Blockhash baked into the message. Client should rebuild if older than ~90s. */
  recentBlockhash: string;
  /** Approximate user-side cost in lamports (priority + base fee). 1 SOL = 1e9 lamports. */
  estimatedFeeLamports: number;
}

const BASE_TX_FEE_LAMPORTS = 5_000;

export async function buildUnsignedTx(params: BuildUnsignedTxParams): Promise<UnsignedTxResult> {
  const connection = params.connection ?? getConnection();
  const payer = params.payer ?? getFeePayerKeypair();
  const computeUnits = params.computeUnits ?? 200_000;
  const priorityLevel = params.priorityLevel ?? "Medium";

  // Collect all unique account pubkeys for Helius's priority fee estimate.
  const accountKeySet = new Set<string>();
  for (const ix of params.instructions) {
    for (const meta of ix.keys) accountKeySet.add(meta.pubkey.toBase58());
    accountKeySet.add(ix.programId.toBase58());
  }
  const microLamports = await getPriorityFeeMicroLamports(Array.from(accountKeySet), priorityLevel);

  const allInstructions: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: BigInt(microLamports) }),
    ...params.instructions,
  ];

  const { blockhash } = await connection.getLatestBlockhash("confirmed");

  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: allInstructions,
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);
  // Partial sign by backend. The user adds their own signature later (if required by the ix).
  tx.sign([payer, ...(params.signers ?? [])]);

  const serialized = tx.serialize();
  const unsignedTxBase64 = Buffer.from(serialized).toString("base64");

  // Priority fee in lamports = microLamports * computeUnits / 1_000_000.
  const priorityFeeLamports = Math.ceil((microLamports * computeUnits) / 1_000_000);
  const estimatedFeeLamports = priorityFeeLamports + BASE_TX_FEE_LAMPORTS;

  return { unsignedTxBase64, recentBlockhash: blockhash, estimatedFeeLamports };
}
