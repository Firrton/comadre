/**
 * Bootstrap on-chain profile for a freshly-onboarded user.
 *
 * Two on-chain actions in one tx:
 *   1. `init_user_profile(phone_hash, country_code)` — fee_payer pays rent; user wallet does NOT sign.
 *   2. `update_kyc_tier({ t1Lite: {} })` — signed by kyc_oracle.
 *
 * Idempotent: if the UserProfile PDA already exists on-chain both instructions are skipped.
 *
 * Also exports `airdropIfNeeded` which tops up a wallet from fee_payer if the
 * balance is below the threshold — avoids the devnet faucet rate limit.
 */

import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { Wallet } from "@coral-xyz/anchor";
import {
  getComadreProgram,
  deriveUserProfilePda,
} from "@comadre/anchor-client";
import {
  getConnection,
  getFeePayerKeypair,
  getKycOracleKeypair,
  buildUnsignedTx,
  submitWithRetry,
} from "@comadre/solana";

const AIRDROP_THRESHOLD_LAMPORTS = 0.01 * LAMPORTS_PER_SOL;
const AIRDROP_AMOUNT_LAMPORTS = 0.05 * LAMPORTS_PER_SOL;

/**
 * Transfer SOL from fee_payer to `wallet` if its balance is below threshold.
 * Skips if already funded.
 */
export async function airdropIfNeeded(
  walletAddress: string,
  thresholdLamports: number = AIRDROP_THRESHOLD_LAMPORTS
): Promise<void> {
  const connection = getConnection();
  const feePayer = getFeePayerKeypair();
  const target = new PublicKey(walletAddress);

  const balance = await connection.getBalance(target, "confirmed");
  if (balance >= thresholdLamports) return;

  const transferAmount = AIRDROP_AMOUNT_LAMPORTS;
  const ix = SystemProgram.transfer({
    fromPubkey: feePayer.publicKey,
    toPubkey: target,
    lamports: transferAmount,
  });

  const built = await buildUnsignedTx({ instructions: [ix], payer: feePayer });
  const { VersionedTransaction } = await import("@solana/web3.js");
  const tx = VersionedTransaction.deserialize(Buffer.from(built.unsignedTxBase64, "base64"));
  await submitWithRetry(tx);
}

export interface BootstrapOnChainProfileParams {
  walletAddress: string;
  /** hex-encoded SHA-256 of the E.164 phone number */
  phoneHashHex: string;
  /** ISO 3166-1 alpha-2, e.g. "MX" */
  countryCode: string;
}

/**
 * Init user profile + set KYC tier T1Lite in one tx.
 * No-op if the profile PDA already exists on-chain.
 */
export async function bootstrapOnChainProfile(params: BootstrapOnChainProfileParams): Promise<void> {
  const connection = getConnection();
  const feePayer = getFeePayerKeypair();
  const kycOracle = getKycOracleKeypair();

  const walletPubkey = new PublicKey(params.walletAddress);
  const [userProfilePda] = deriveUserProfilePda(walletPubkey);

  // Idempotency check
  const existing = await connection.getAccountInfo(userProfilePda, "confirmed");
  if (existing !== null) return;

  // Decode phone hash hex → [u8; 32]
  if (params.phoneHashHex.length !== 64) {
    throw new Error(`[anchorBootstrap] phoneHashHex must be 64 hex chars, got ${params.phoneHashHex.length}`);
  }
  const phoneHashBytes = Buffer.from(params.phoneHashHex, "hex");
  const phoneHash = Array.from(phoneHashBytes) as number[];

  // Country code → [u8; 2]
  const ccBytes = Buffer.from(params.countryCode.slice(0, 2), "ascii");
  const countryCode = [ccBytes[0] ?? 0, ccBytes[1] ?? 0] as [number, number];

  // Dummy wallet for ix building — fee_payer will actually sign
  const dummyWallet = new Wallet(Keypair.generate());
  const program = getComadreProgram(connection, dummyWallet);

  const initIx = await program.methods
    .initUserProfile(phoneHash, countryCode)
    .accounts({
      wallet: walletPubkey,
      payer: feePayer.publicKey,
    })
    .instruction();

  const kycIx = await program.methods
    .updateKycTier({ t1Lite: {} })
    .accounts({
      wallet: walletPubkey,
      kycOracle: kycOracle.publicKey,
    })
    .instruction();

  const built = await buildUnsignedTx({
    instructions: [initIx, kycIx],
    payer: feePayer,
    signers: [kycOracle],
  });

  const { VersionedTransaction } = await import("@solana/web3.js");
  const tx = VersionedTransaction.deserialize(Buffer.from(built.unsignedTxBase64, "base64"));
  await submitWithRetry(tx);
}
