use anchor_lang::prelude::*;

#[account]
#[derive(Debug)]
pub struct ProgramConfig {
    pub admin: Pubkey,
    pub kyc_oracle: Pubkey,
    pub crank_authority: Pubkey,
    pub usdc_mint: Pubkey,
    pub fee_bps: u16,
    pub fee_destination: Pubkey,
    pub kyc_limits: [u64; 4],
    pub paused: bool,
    pub bump: u8,
}

impl ProgramConfig {
    pub const SIZE: usize = 8 + 32 + 32 + 32 + 32 + 2 + 32 + 32 + 1 + 1;
}
