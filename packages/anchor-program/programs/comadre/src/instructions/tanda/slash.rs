// TODO: slash defaulter — burn member's stake, set is_active=false
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct SlashDefaulter<'info> {
    pub caller: Signer<'info>,
}

pub fn handler(_ctx: Context<SlashDefaulter>) -> Result<()> {
    Ok(())
}
