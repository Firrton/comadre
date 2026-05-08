// TODO: start_tanda — only creator, only when member_current == member_target
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct StartTanda<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
}

pub fn handler(_ctx: Context<StartTanda>) -> Result<()> {
    Ok(())
}
