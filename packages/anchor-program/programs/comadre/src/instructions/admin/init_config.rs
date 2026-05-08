use anchor_lang::prelude::*;

use crate::constants::{SEED_CONFIG, USDC_MINT};
use crate::state::ProgramConfig;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct InitConfigParams {
    pub kyc_oracle: Pubkey,
    pub crank_authority: Pubkey,
    pub fee_bps: u16,
    pub fee_destination: Pubkey,
    pub kyc_limits: [u64; 4],
}

#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(
        init,
        payer = admin,
        space = ProgramConfig::SIZE,
        seeds = [SEED_CONFIG],
        bump
    )]
    pub program_config: Account<'info, ProgramConfig>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitConfig>, params: InitConfigParams) -> Result<()> {
    let config = &mut ctx.accounts.program_config;

    config.admin = ctx.accounts.admin.key();
    config.kyc_oracle = params.kyc_oracle;
    config.crank_authority = params.crank_authority;
    config.usdc_mint = USDC_MINT;
    config.fee_bps = params.fee_bps;
    config.fee_destination = params.fee_destination;
    config.kyc_limits = params.kyc_limits;
    config.paused = false;
    config.bump = ctx.bumps.program_config;

    Ok(())
}
