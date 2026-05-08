use anchor_lang::prelude::*;

use crate::constants::SEED_CONFIG;
use crate::errors::ComadreError;
use crate::events::TandaCompleted;
use crate::state::{ProgramConfig, Tanda, TandaState};

#[derive(Accounts)]
pub struct CompleteTanda<'info> {
    /// Must equal program_config.crank_authority.
    pub crank: Signer<'info>,

    #[account(mut)]
    pub tanda: Account<'info, Tanda>,

    #[account(
        seeds = [SEED_CONFIG],
        bump = program_config.bump,
    )]
    pub program_config: Account<'info, ProgramConfig>,
}

pub fn handler(ctx: Context<CompleteTanda>) -> Result<()> {
    let config = &ctx.accounts.program_config;

    // ── Crank-authority guard ───────────────────────────────────────────────
    require!(
        ctx.accounts.crank.key() == config.crank_authority,
        ComadreError::Unauthorized
    );

    // ── Global pause guard ──────────────────────────────────────────────────
    require!(!config.paused, ComadreError::ProgramPaused);

    let tanda = &ctx.accounts.tanda;

    // Requires Active OR Completed state AND all turns exhausted (current_turn > total_turns).
    // In practice payout already transitions to Completed on the last turn,
    // so this instruction is a safety fallback / explicit completeness marker.
    require!(
        tanda.state == TandaState::Active || tanda.state == TandaState::Completed,
        ComadreError::TandaNotActive
    );
    require!(
        tanda.current_turn > tanda.total_turns,
        ComadreError::InvalidMemberCount // reuse — "not all turns completed yet"
    );

    // ── Transition ──────────────────────────────────────────────────────────
    let now = Clock::get()?.unix_timestamp;
    let tanda = &mut ctx.accounts.tanda;
    tanda.state = TandaState::Completed;

    // TODO(stake-return): returning stakes to members requires iterating all
    // Member accounts, which in Anchor means passing them as remaining_accounts.
    // This is non-trivial and deferred to a separate `claim_stake` instruction
    // in a future iteration. Stake funds remain in the vault until members call
    // claim_stake to retrieve their locked stake.

    emit!(TandaCompleted {
        tanda: tanda.key(),
        timestamp: now,
    });

    Ok(())
}
