// TODO: complete_tanda — mark Completed, return stakes, mint badges
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct CompleteTanda<'info> {
    pub crank: Signer<'info>,
}

pub fn handler(_ctx: Context<CompleteTanda>) -> Result<()> {
    Ok(())
}
