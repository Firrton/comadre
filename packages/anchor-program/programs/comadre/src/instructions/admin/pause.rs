use anchor_lang::prelude::*;

use crate::constants::SEED_CONFIG;
use crate::errors::ComadreError;
use crate::state::ProgramConfig;

#[derive(Accounts)]
pub struct Pause<'info> {
    #[account(
        mut,
        seeds = [SEED_CONFIG],
        bump = program_config.bump,
        has_one = admin @ ComadreError::Unauthorized,
    )]
    pub program_config: Account<'info, ProgramConfig>,

    pub admin: Signer<'info>,
}

pub fn handler(ctx: Context<Pause>, paused: bool) -> Result<()> {
    ctx.accounts.program_config.paused = paused;
    Ok(())
}
