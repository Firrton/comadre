// TODO: payout — transfer from vault to current beneficiary, advance turn
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct Payout<'info> {
    pub crank: Signer<'info>,
}

pub fn handler(_ctx: Context<Payout>) -> Result<()> {
    Ok(())
}
