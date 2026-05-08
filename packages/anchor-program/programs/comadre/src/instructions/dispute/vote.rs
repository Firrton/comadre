// TODO: vote_dispute — only members, one vote per dispute via PDA
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct VoteDispute<'info> {
    #[account(mut)]
    pub voter: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(_ctx: Context<VoteDispute>, _continue_tanda: bool) -> Result<()> {
    Ok(())
}
