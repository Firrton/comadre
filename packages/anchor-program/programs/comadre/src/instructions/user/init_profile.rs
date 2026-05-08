use anchor_lang::prelude::*;

use crate::constants::SEED_USER;
use crate::events::UserProfileInitialized;
use crate::state::{KycTier, UserProfile};

#[derive(Accounts)]
pub struct InitUserProfile<'info> {
    #[account(
        init,
        payer = payer,
        space = UserProfile::SIZE,
        seeds = [SEED_USER, wallet.key().as_ref()],
        bump
    )]
    pub user_profile: Account<'info, UserProfile>,

    /// CHECK: this is the wallet owner; signed in client side, not on-chain
    pub wallet: AccountInfo<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitUserProfile>,
    phone_hash: [u8; 32],
    country_code: [u8; 2],
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let profile = &mut ctx.accounts.user_profile;

    profile.wallet = ctx.accounts.wallet.key();
    profile.phone_hash = phone_hash;
    profile.country_code = country_code;
    profile.kyc_tier = KycTier::T0Demo;
    profile.reputation_score = 0;
    profile.tandas_completed = 0;
    profile.tandas_defaulted = 0;
    profile.tandas_created = 0;
    profile.loans_repaid = 0;
    profile.loans_defaulted = 0;
    profile.created_at = now;
    profile.bump = ctx.bumps.user_profile;

    emit!(UserProfileInitialized {
        wallet: profile.wallet,
        phone_hash,
        country_code,
        timestamp: now,
    });

    Ok(())
}
