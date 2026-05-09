/**
 * Build SPL Token Transfer instructions for USDC P2P payments.
 *
 * Returns an array of instructions that:
 *   1. Optionally creates the recipient's USDC ATA (if missing) — paid by `payer`
 *   2. Transfers `amountMicroUsdc` from sender's ATA to recipient's ATA
 *
 * The caller is responsible for signing: the sender signs as `transfer authority`,
 * and `payer` (typically FEE_PAYER) signs as the rent payer for ATA creation.
 *
 * Convention: amounts are passed in atomic units (USDC has 6 decimals, so 1 USDC
 * = 1_000_000 atomic). `bigint` to avoid IEEE-754 precision loss on >2^53 values.
 */

import type { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
} from "@solana/spl-token";

export interface BuildUsdcTransferParams {
  /** Sender's wallet (transfer authority — must sign the tx). */
  from: PublicKey;
  /** Recipient's wallet. */
  to: PublicKey;
  /** Atomic units (USDC has 6 decimals). 1 USDC = 1_000_000n. */
  amountMicroUsdc: bigint;
  /** USDC mint address (devnet/mainnet vary). */
  mint: PublicKey;
  /**
   * Account that pays for the recipient ATA rent if creation is needed.
   * Typically the FEE_PAYER backend wallet. Must sign the tx if ATA is created.
   */
  payer: PublicKey;
  /**
   * RPC connection used to check ATA existence. If omitted, the helper
   * assumes the recipient ATA exists and emits no creation ix (the caller
   * is responsible). Default behavior: probe via getAccountInfo.
   */
  connection?: Connection;
}

export interface BuildUsdcTransferResult {
  /** Instructions in execution order. */
  instructions: TransactionInstruction[];
  /** Resolved sender's ATA address. */
  senderAta: PublicKey;
  /** Resolved recipient's ATA address. */
  recipientAta: PublicKey;
  /** True if a `createAssociatedTokenAccountInstruction` was prepended. */
  createdRecipientAta: boolean;
}

/**
 * Build the instructions for an SPL USDC transfer.
 *
 * Behavior:
 *  - Resolves sender + recipient ATAs deterministically from wallet+mint
 *  - If `connection` provided AND recipient ATA doesn't exist on-chain, prepends
 *    `createAssociatedTokenAccountInstruction(payer, recipient_ata, recipient, mint)`
 *  - Always emits `createTransferInstruction(sender_ata, recipient_ata, sender, amount)`
 *
 * Edge cases:
 *  - Sender ATA missing: throws (sender has no USDC, can't transfer)
 *  - amount = 0: throws (callers must validate upstream)
 */
export async function buildUsdcTransferIxs(params: BuildUsdcTransferParams): Promise<BuildUsdcTransferResult> {
  if (params.amountMicroUsdc <= 0n) {
    throw new Error("[usdc-transfer] amountMicroUsdc must be positive");
  }

  const senderAta = getAssociatedTokenAddressSync(params.mint, params.from);
  const recipientAta = getAssociatedTokenAddressSync(params.mint, params.to);

  const instructions: TransactionInstruction[] = [];
  let createdRecipientAta = false;

  if (params.connection) {
    // Check if recipient ATA already exists. If not, prepend a creation ix.
    const recipientInfo = await params.connection.getAccountInfo(recipientAta, "confirmed");
    if (recipientInfo === null) {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          params.payer, // rent payer
          recipientAta,
          params.to, // owner
          params.mint
        )
      );
      createdRecipientAta = true;
    }

    // Sanity-check sender ATA exists. (Cheap guard before broadcast fails.)
    const senderInfo = await params.connection.getAccountInfo(senderAta, "confirmed");
    if (senderInfo === null) {
      throw new Error(
        `[usdc-transfer] Sender ATA ${senderAta.toBase58()} does not exist; sender has no USDC token account`
      );
    }
  }

  instructions.push(
    createTransferInstruction(
      senderAta,
      recipientAta,
      params.from, // authority
      params.amountMicroUsdc,
      [],
      TOKEN_PROGRAM_ID
    )
  );

  return { instructions, senderAta, recipientAta, createdRecipientAta };
}

/**
 * Convert USDC decimal-string ("10.50") to micro-USDC bigint.
 * Throws if input has > 6 decimals or is not a positive amount.
 */
export function usdcToMicro(usdcDecimal: string): bigint {
  if (!/^\d+(\.\d{1,6})?$/.test(usdcDecimal)) {
    throw new RangeError(`Invalid USDC amount: ${usdcDecimal}`);
  }
  const [whole, frac = ""] = usdcDecimal.split(".");
  const fracPadded = frac.padEnd(6, "0");
  const value = BigInt(whole ?? "0") * 1_000_000n + BigInt(fracPadded);
  if (value <= 0n) {
    throw new RangeError("Amount must be positive");
  }
  return value;
}

/** Inverse: micro-USDC bigint to "10.50" style decimal string. */
export function microToUsdc(microUsdc: bigint): string {
  if (microUsdc < 0n) throw new RangeError("Cannot format negative amount");
  const whole = microUsdc / 1_000_000n;
  const frac = microUsdc % 1_000_000n;
  if (frac === 0n) return whole.toString();
  // Trim trailing zeros from the fractional part
  const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}
