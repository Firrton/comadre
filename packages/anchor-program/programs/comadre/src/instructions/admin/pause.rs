// TODO: pause/unpause global kill switch
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct Pause<'info> {
    pub admin: Signer<'info>,
}

pub fn handler(_ctx: Context<Pause>, _paused: bool) -> Result<()> {
    Ok(())
}
