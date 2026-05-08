use anchor_lang::prelude::*;

#[cfg(not(feature = "localnet"))]
use crate::constants::INITIAL_DEPLOYER;
use crate::constants::{SEED_CONFIG, USDC_MINT};
use crate::errors::ComadreError;
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

    /// Only the designated deployer may call init_config (prevents front-run race condition).
    /// In localnet/test mode this constraint is skipped — see handler below.
    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitConfig>, params: InitConfigParams) -> Result<()> {
    // Deployer-only guard: only the pre-registered deployer pubkey may call init_config.
    // Prevents a front-run race condition where an attacker deploys and calls init_config
    // before the real deployer, setting themselves as admin.
    // NOTE: skipped in localnet/test mode (feature = "localnet"). Replace INITIAL_DEPLOYER
    // with the real deployer pubkey before mainnet deploy.
    #[cfg(not(feature = "localnet"))]
    require!(
        ctx.accounts.admin.key() == INITIAL_DEPLOYER,
        ComadreError::Unauthorized
    );

    require!(params.fee_bps <= 10_000, ComadreError::InvalidFeeBps);
    require!(params.kyc_limits[0] > 0, ComadreError::InvalidKycLimits);
    require!(
        params.kyc_limits.windows(2).all(|w| w[0] <= w[1]),
        ComadreError::InvalidKycLimits
    );

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
