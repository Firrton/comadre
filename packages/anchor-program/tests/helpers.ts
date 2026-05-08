import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import type { Comadre } from "../target/types/comadre";

// ─── Constants ────────────────────────────────────────────────────────────────

export const SEED_USER         = Buffer.from("user");
export const SEED_CONFIG       = Buffer.from("config");
export const SEED_TANDA        = Buffer.from("tanda");
export const SEED_MEMBER       = Buffer.from("member");
export const SEED_VAULT        = Buffer.from("vault");
export const SEED_DISPUTE      = Buffer.from("dispute");
export const SEED_DISPUTE_VOTE = Buffer.from("dispute_vote");

// ─── Provider & Program ───────────────────────────────────────────────────────

/** Returns the AnchorProvider configured from the environment (localnet). */
export function getProvider(): AnchorProvider {
  return AnchorProvider.env();
}

/** Returns the loaded Comadre program. */
export function getProgram(provider: AnchorProvider): Program<Comadre> {
  return anchor.workspace.Comadre as Program<Comadre>;
}

// ─── PDA derivation helpers ───────────────────────────────────────────────────

/** Derives [programConfigPda, bump] for the singleton ProgramConfig account. */
export function deriveConfigPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([SEED_CONFIG], programId);
}

/** Derives [userProfilePda, bump] for a wallet address. */
export function deriveUserProfilePda(
  wallet: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEED_USER, wallet.toBuffer()],
    programId
  );
}

/**
 * Derives [tandaPda, bump] for a (creator, tanda_id) pair.
 * Seeds: ["tanda", creator, tanda_id_le_bytes]
 */
export function deriveTandaPda(
  creator: PublicKey,
  tandaId: BN,
  programId: PublicKey
): [PublicKey, number] {
  const idBuf = Buffer.alloc(8);
  idBuf.set(tandaId.toArrayLike(Buffer, "le", 8));
  return PublicKey.findProgramAddressSync(
    [SEED_TANDA, creator.toBuffer(), idBuf],
    programId
  );
}

/**
 * Derives [memberPda, bump] for a (tanda, user) pair.
 * Seeds: ["member", tanda, user]
 */
export function deriveMemberPda(
  tanda: PublicKey,
  user: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEED_MEMBER, tanda.toBuffer(), user.toBuffer()],
    programId
  );
}

/**
 * Derives [vaultPda, bump] for a tanda.
 * Seeds: ["vault", tanda]
 */
export function deriveVaultPda(
  tanda: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEED_VAULT, tanda.toBuffer()],
    programId
  );
}

/**
 * Derives [disputePda, bump] for a (tanda, dispute_id) pair.
 * Seeds: ["dispute", tanda, dispute_id_byte]
 */
export function deriveDisputePda(
  tanda: PublicKey,
  disputeId: number,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEED_DISPUTE, tanda.toBuffer(), Buffer.from([disputeId])],
    programId
  );
}

/**
 * Derives [disputeVotePda, bump] for a (dispute, voter) pair.
 * Seeds: ["dispute_vote", dispute, voter]
 */
export function deriveDisputeVotePda(
  dispute: PublicKey,
  voter: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEED_DISPUTE_VOTE, dispute.toBuffer(), voter.toBuffer()],
    programId
  );
}

// ─── Airdrop helper ───────────────────────────────────────────────────────────

/**
 * Airdrops `sol` SOL to `target` and waits for confirmation.
 * Works on localnet where airdrops are free.
 */
export async function airdrop(
  provider: AnchorProvider,
  target: PublicKey,
  sol: number = 10,
  retries: number = 5
): Promise<void> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const sig = await provider.connection.requestAirdrop(
        target,
        sol * LAMPORTS_PER_SOL
      );
      const { blockhash, lastValidBlockHeight } =
        await provider.connection.getLatestBlockhash("confirmed");
      await provider.connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        "confirmed"
      );
      return;
    } catch (err: any) {
      if (attempt === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, 800));
    }
  }
}

// ─── USDC helpers (real SPL mint) ─────────────────────────────────────────────

/**
 * Creates a real SPL Token mint owned by `mintAuthority`.
 * The `payer` keypair pays for the mint account rent.
 */
export async function createUsdcMint(
  provider: AnchorProvider,
  payer: Keypair,
  mintAuthority: PublicKey
): Promise<PublicKey> {
  return createMint(
    provider.connection,
    payer,
    mintAuthority,
    null,        // freeze authority — none
    6,           // decimals (USDC = 6)
    Keypair.generate(), // fresh mint keypair
    { commitment: "confirmed" }
  );
}

/**
 * Creates an Associated Token Account for `owner` and the given `mint`.
 * Returns the ATA public key.
 */
export async function createUsdcAta(
  provider: AnchorProvider,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey
): Promise<PublicKey> {
  return createAssociatedTokenAccount(
    provider.connection,
    payer,
    mint,
    owner,
    { commitment: "confirmed" }
  );
}

/**
 * Mints `amount` tokens (in raw lamports/smallest unit) to `destination` ATA.
 * `mintAuthority` must be the keypair that was set as mint authority.
 */
export async function mintUsdcTo(
  provider: AnchorProvider,
  payer: Keypair,
  mint: PublicKey,
  destination: PublicKey,
  mintAuthority: Keypair,
  amount: number | bigint
): Promise<void> {
  await mintTo(
    provider.connection,
    payer,
    mint,
    destination,
    mintAuthority,
    amount,
    [],
    { commitment: "confirmed" }
  );
}

/**
 * Returns an existing ATA address or creates one if it doesn't exist.
 */
export async function getOrCreateUsdcAta(
  provider: AnchorProvider,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey
): Promise<PublicKey> {
  const ata = await getAssociatedTokenAddress(mint, owner);
  const info = await provider.connection.getAccountInfo(ata);
  if (!info) {
    return createUsdcAta(provider, payer, mint, owner);
  }
  return ata;
}

// ─── Misc helpers ─────────────────────────────────────────────────────────────

/** Generates a fresh funded keypair. */
export async function newFundedKeypair(
  provider: AnchorProvider
): Promise<Keypair> {
  const kp = Keypair.generate();
  await airdrop(provider, kp.publicKey);
  return kp;
}

/**
 * @deprecated Use createUsdcMint() instead.
 * Legacy stub kept for backward-compat — returns a stub pubkey, no mint created.
 */
export async function createMockUsdcMint(
  _provider: AnchorProvider,
  _mintAuthority: Keypair
): Promise<PublicKey> {
  return Keypair.generate().publicKey;
}
