// TODO: open_dispute — pauses tanda, creates Dispute account
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct OpenDispute<'info> {
    #[account(mut)]
    pub opener: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(_ctx: Context<OpenDispute>, _reason_hash: [u8; 32]) -> Result<()> {
    Ok(())
}
