// TODO: init_config — singleton, only deployer
use anchor_lang::prelude::*;

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
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(_ctx: Context<InitConfig>, _params: InitConfigParams) -> Result<()> {
    Ok(())
}
