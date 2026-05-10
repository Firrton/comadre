/**
 * Build the `create_tanda` Anchor instruction.
 *
 * Returns the raw `TransactionInstruction` plus the derived PDAs so the
 * caller can mirror them into the DB without re-deriving.
 *
 * Signing requirements (from IDL):
 *   - `creator`  — signer, writable (pays tanda + vault rent)
 *   - fee_payer  — injected by `buildUnsignedTx` as the tx payer, covers priority fee
 *
 * The on-chain handler validates:
 *   - program_config.paused == false
 *   - usdc_mint == config.usdc_mint
 *   - member_target ∈ [3, MAX_MEMBERS]
 *   - contribution_amount > 0, stake_amount > 0
 *   - frequency_seconds >= 86_400
 *   - creator_profile.kyc_tier >= T1Lite
 */

import { createHash } from "node:crypto";
import { Keypair, PublicKey } from "@solana/web3.js";
import { BN, Wallet } from "@coral-xyz/anchor";
import {
  getComadreProgram,
  deriveTandaPda,
  deriveVaultPda,
} from "@comadre/anchor-client";
import { getConnection } from "@comadre/solana";
import type { TransactionInstruction } from "@solana/web3.js";

export type PayoutOrderMode = "join_order" | "creator_set" | "random";

export interface BuildCreateTandaIxParams {
  /** Creator's wallet (must sign the tx). */
  creator: PublicKey;
  /** Human-readable tanda name — SHA-256 hashed for on-chain storage. */
  name: string;
  /** Number of members (3–MAX_MEMBERS). */
  memberTarget: number;
  /** Per-round contribution in atomic USDC units (bigint). */
  contributionAmountAtomic: bigint;
  /** Collateral stake per member in atomic USDC units (bigint). */
  stakeAmountAtomic: bigint;
  /** Round cadence in seconds (≥ 86_400). */
  frequencySeconds: number;
  /** Payout ordering strategy. */
  payoutOrderMode: PayoutOrderMode;
  /** Creator-scoped sequential tanda ID (0, 1, 2, …). */
  tandaId: bigint;
}

export interface BuildCreateTandaIxResult {
  instruction: TransactionInstruction;
  tandaPda: PublicKey;
  vaultPda: PublicKey;
}

type AnchorPayoutOrder =
  | { joinOrder: Record<string, never> }
  | { creatorSet: Record<string, never> }
  | { random: Record<string, never> };

function toPayoutOrderArg(mode: PayoutOrderMode): AnchorPayoutOrder {
  switch (mode) {
    case "join_order":
      return { joinOrder: {} };
    case "creator_set":
      return { creatorSet: {} };
    case "random":
      return { random: {} };
  }
}

export async function buildCreateTandaIx(params: BuildCreateTandaIxParams): Promise<BuildCreateTandaIxResult> {
  const usdcMintStr = process.env["USDC_MINT"];
  if (!usdcMintStr) throw new Error("[buildCreateTandaIx] USDC_MINT env var is required");

  const usdcMint = new PublicKey(usdcMintStr);
  const connection = getConnection();

  // Dummy wallet for ix-build-only Program instance (no signing needed here).
  const dummyWallet = new Wallet(Keypair.generate());
  const program = getComadreProgram(connection, dummyWallet);

  // Derive PDAs we need to return (Anchor auto-resolves creatorProfile, programConfig, vault from seeds)
  const [tandaPda] = deriveTandaPda(params.creator, params.tandaId);
  const [vaultPda] = deriveVaultPda(tandaPda);

  // name_hash: SHA-256(name) → 32-byte Uint8Array → number[]
  const nameHashBytes = createHash("sha256").update(params.name).digest();
  const nameHash = Array.from(nameHashBytes) as number[];

  const instruction = await program.methods
    .createTanda({
      tandaId: new BN(params.tandaId.toString()),
      nameHash,
      memberTarget: params.memberTarget,
      contributionAmount: new BN(params.contributionAmountAtomic.toString()),
      stakeAmount: new BN(params.stakeAmountAtomic.toString()),
      frequencySeconds: params.frequencySeconds,
      payoutOrderMode: toPayoutOrderArg(params.payoutOrderMode),
    })
    .accounts({
      creator: params.creator,
      usdcMint,
    })
    .instruction();

  return { instruction, tandaPda, vaultPda };
}
