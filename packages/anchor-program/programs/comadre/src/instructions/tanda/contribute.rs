// TODO: contribute — transfer USDC from user ATA to vault
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct Contribute<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
}

pub fn handler(_ctx: Context<Contribute>) -> Result<()> {
    Ok(())
}
