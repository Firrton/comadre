// TODO: implement create_tanda — creates Tanda PDA + Vault ATA
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CreateTandaParams {
    pub name_hash: [u8; 32],
    pub member_target: u8,
    pub contribution_amount: u64,
    pub stake_amount: u64,
    pub frequency_seconds: u32,
}

#[derive(Accounts)]
pub struct CreateTanda<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(_ctx: Context<CreateTanda>, _params: CreateTandaParams) -> Result<()> {
    Ok(())
}
