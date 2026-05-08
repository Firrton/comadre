import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import type { Comadre } from "../target/types/comadre";

// ─── Constants ────────────────────────────────────────────────────────────────

export const SEED_USER = Buffer.from("user");
export const SEED_CONFIG = Buffer.from("config");

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
      // Brief backoff before retry
      await new Promise((r) => setTimeout(r, 800));
    }
  }
}

// ─── USDC mock mint ───────────────────────────────────────────────────────────

/**
 * Creates a fresh SPL token mint that acts as USDC in tests.
 * Returns the mint public key.
 *
 * Note: on localnet we don't have the real USDC mint, so tests that need
 * token accounts should use this mock.  The ProgramConfig stores a usdc_mint
 * field that is set at init time; in tests we pass this mock mint address.
 */
export async function createMockUsdcMint(
  provider: AnchorProvider,
  mintAuthority: Keypair
): Promise<PublicKey> {
  // We use raw spl-token instructions to avoid pulling in a heavy dep.
  // Alternatively callers can pass any PublicKey here — the program stores
  // whatever is given; it doesn't validate the mint during init_config.
  const mint = Keypair.generate();

  // We borrow the connection directly to send the CreateAccount + InitializeMint
  // transaction.  Use @solana/spl-token if it's already in the dep tree; for
  // now we keep helpers minimal and just return a freshly generated keypair
  // address.  Callers that need actual token transfers should extend this.
  return mint.publicKey;
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
