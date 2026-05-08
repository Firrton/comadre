// TODO: resolve_dispute — anyone can call after deadline, applies majority
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct ResolveDispute<'info> {
    pub caller: Signer<'info>,
}

pub fn handler(_ctx: Context<ResolveDispute>) -> Result<()> {
    Ok(())
}
