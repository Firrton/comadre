// TODO: kyc_oracle signs to update tier after Sumsub webhook
use anchor_lang::prelude::*;
use crate::state::{KycTier, UserProfile};

#[derive(Accounts)]
pub struct UpdateKycTier<'info> {
    #[account(mut)]
    pub user_profile: Account<'info, UserProfile>,
    pub kyc_oracle: Signer<'info>,
}

pub fn handler(_ctx: Context<UpdateKycTier>, _new_tier: KycTier) -> Result<()> {
    // TODO: validate kyc_oracle matches ProgramConfig.kyc_oracle, update tier, emit event
    Ok(())
}
