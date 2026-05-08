use anchor_lang::prelude::*;

use crate::constants::{SEED_CONFIG, SEED_USER};
use crate::errors::ComadreError;
use crate::events::KycTierUpdated;
use crate::state::{KycTier, ProgramConfig, UserProfile};

#[derive(Accounts)]
pub struct UpdateKycTier<'info> {
    #[account(
        mut,
        seeds = [SEED_USER, user_profile.wallet.as_ref()],
        bump = user_profile.bump,
    )]
    pub user_profile: Account<'info, UserProfile>,

    #[account(
        seeds = [SEED_CONFIG],
        bump = program_config.bump,
    )]
    pub program_config: Account<'info, ProgramConfig>,

    /// CHECK: validated against program_config.kyc_oracle below
    pub kyc_oracle: Signer<'info>,
}

pub fn handler(ctx: Context<UpdateKycTier>, new_tier: KycTier) -> Result<()> {
    let config = &ctx.accounts.program_config;

    require!(!config.paused, ComadreError::ProgramPaused);
    require!(
        ctx.accounts.kyc_oracle.key() == config.kyc_oracle,
        ComadreError::Unauthorized
    );

    let profile = &mut ctx.accounts.user_profile;
    profile.kyc_tier = new_tier;

    let now = Clock::get()?.unix_timestamp;
    emit!(KycTierUpdated {
        wallet: profile.wallet,
        new_tier: new_tier as u8,
        timestamp: now,
    });

    Ok(())
}
