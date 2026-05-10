/**
 * Build the join_tanda Anchor instructions.
 *
 * Returns: [(optional) createATA, joinTanda] — one tx with both.
 *
 * Signing requirements:
 *   - user — signer, writable (pays member rent + ATA rent if needed)
 *   - fee_payer — outer tx payer (priority fee)
 *
 * Validation in handler:
 *   - tanda.state == Forming
 *   - tanda.member_current < member_target
 *   - kyc_limits[user.kyc_tier] >= contribution + stake
 *   - user_usdc_ata has at least stake_amount USDC
 */
import { Keypair, PublicKey } from "@solana/web3.js";
import { Wallet } from "@coral-xyz/anchor";
import {
  getComadreProgram,
  deriveVaultPda,
  deriveMemberPda,
} from "@comadre/anchor-client";
import { getConnection } from "@comadre/solana";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import type { TransactionInstruction } from "@solana/web3.js";

export interface BuildJoinTandaIxParams {
  user: PublicKey;
  tanda: PublicKey;
  /** 0 for join_order (program auto-assigns); for creator_set, caller-supplied. */
  turnNumber?: number;
}

export interface BuildJoinTandaIxResult {
  instructions: TransactionInstruction[];
  memberPda: PublicKey;
  userUsdcAta: PublicKey;
}

export async function buildJoinTandaIx(
  params: BuildJoinTandaIxParams,
): Promise<BuildJoinTandaIxResult> {
  const usdcMintStr = process.env["USDC_MINT"];
  if (!usdcMintStr) throw new Error("[buildJoinTandaIx] USDC_MINT env var is required");
  const usdcMint = new PublicKey(usdcMintStr);

  const connection = getConnection();
  const dummyWallet = new Wallet(Keypair.generate());
  const program = getComadreProgram(connection, dummyWallet);

  const [memberPda] = deriveMemberPda(params.tanda, params.user);
  const [vaultPda] = deriveVaultPda(params.tanda);
  const userUsdcAta = await getAssociatedTokenAddress(usdcMint, params.user, false, TOKEN_PROGRAM_ID);

  const instructions: TransactionInstruction[] = [];

  // Create user's USDC ATA if missing — user pays rent
  const ataInfo = await connection.getAccountInfo(userUsdcAta, "confirmed");
  if (!ataInfo) {
    instructions.push(
      createAssociatedTokenAccountInstruction(
        params.user,
        userUsdcAta,
        params.user,
        usdcMint,
      ),
    );
  }

  const joinIx = await program.methods
    .joinTanda(params.turnNumber ?? 0)
    .accounts({
      user: params.user,
      tanda: params.tanda,
      vault: vaultPda,
      userUsdcAta,
      usdcMint,
    })
    .instruction();

  instructions.push(joinIx);

  return { instructions, memberPda, userUsdcAta };
}
