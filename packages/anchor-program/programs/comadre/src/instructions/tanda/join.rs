// TODO: join_tanda — creates Member PDA, locks stake in Vault
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct JoinTanda<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(_ctx: Context<JoinTanda>, _turn_number: u8) -> Result<()> {
    Ok(())
}
