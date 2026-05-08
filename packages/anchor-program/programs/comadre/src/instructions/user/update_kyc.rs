use anchor_lang::prelude::*;

use crate::constants::{SEED_CONFIG, SEED_USER};
use crate::errors::ComadreError;
use crate::events::KycTierUpdated;
use crate::state::{KycTier, ProgramConfig, UserProfile};

#[derive(Accounts)]
pub struct UpdateKycTier<'info> {
    #[account(
        mut,
        seeds = [SEED_USER, wallet.key().as_ref()],
        bump = user_profile.bump,
    )]
    pub user_profile: Account<'info, UserProfile>,

    /// CHECK: this is the wallet owner whose profile is being updated; pubkey only, no signing required
    pub wallet: UncheckedAccount<'info>,

    #[account(
        seeds = [SEED_CONFIG],
        bump = program_config.bump,
    )]
    pub program_config: Account<'info, ProgramConfig>,

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
