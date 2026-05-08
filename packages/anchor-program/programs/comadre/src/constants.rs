use anchor_lang::prelude::*;

pub const MAX_MEMBERS: usize = 20;
pub const MAX_NAME_LEN: usize = 32;
pub const MAX_DISPUTES_PER_TANDA: u8 = 5;

pub const DISPUTE_VOTING_WINDOW_SECONDS: i64 = 7 * 24 * 60 * 60;

pub const SEED_USER: &[u8] = b"user";
pub const SEED_TANDA: &[u8] = b"tanda";
pub const SEED_MEMBER: &[u8] = b"member";
pub const SEED_DISPUTE: &[u8] = b"dispute";
pub const SEED_VOTE: &[u8] = b"vote";
pub const SEED_LOAN: &[u8] = b"loan";
pub const SEED_COSIGNER: &[u8] = b"cosigner";
pub const SEED_BADGE: &[u8] = b"badge";
pub const SEED_CONFIG: &[u8] = b"config";

// TODO: replace this placeholder with the real deployer pubkey before mainnet deploy.
// Only this address is allowed to call `init_config` to prevent a race-condition
// where an attacker front-runs the first init and sets themselves as admin.
// Pattern: INITIAL_DEPLOYER constant (simpler / localnet-safe alternative to
// upgrade-authority ProgramData account derivation).
pub const INITIAL_DEPLOYER: anchor_lang::prelude::Pubkey =
    anchor_lang::solana_program::pubkey!("11111111111111111111111111111111");

#[cfg(feature = "devnet")]
pub const USDC_MINT: Pubkey = anchor_lang::solana_program::pubkey!(
    "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
);

#[cfg(not(feature = "devnet"))]
pub const USDC_MINT: Pubkey = anchor_lang::solana_program::pubkey!(
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
);
