use anchor_lang::prelude::*;

use crate::constants::SEED_CONFIG;
use crate::errors::ComadreError;
use crate::events::DisputeResolved;
use crate::state::{Dispute, DisputeState, ProgramConfig, Tanda, TandaState};

#[derive(Accounts)]
pub struct ResolveDispute<'info> {
    /// Anyone may call resolve after the voting deadline — it's a public-good crank.
    pub resolver: Signer<'info>,

    #[account(mut)]
    pub dispute: Account<'info, Dispute>,

    /// Must equal dispute.tanda.
    #[account(
        mut,
        address = dispute.tanda @ ComadreError::Unauthorized,
    )]
    pub tanda: Account<'info, Tanda>,

    #[account(
        seeds = [SEED_CONFIG],
        bump = program_config.bump,
    )]
    pub program_config: Account<'info, ProgramConfig>,
}

pub fn handler(ctx: Context<ResolveDispute>) -> Result<()> {
    let config = &ctx.accounts.program_config;

    // ── Global pause guard ──────────────────────────────────────────────────
    require!(!config.paused, ComadreError::ProgramPaused);

    let dispute = &ctx.accounts.dispute;

    // ── Dispute must be Open ────────────────────────────────────────────────
    require!(
        dispute.state == DisputeState::Open,
        ComadreError::DisputeNotOpen
    );

    // ── Voting window must have elapsed ────────────────────────────────────
    // Rationale: we wait for the full window to give all members a fair chance to vote.
    let now = Clock::get()?.unix_timestamp;
    require!(now > dispute.deadline_ts, ComadreError::DisputeNotExpired);

    let votes_continue = dispute.votes_continue;
    let votes_cancel = dispute.votes_cancel;

    // ── Apply majority; ties go to "cancel" (protect users by stopping the tanda) ──
    let continue_wins = votes_continue > votes_cancel;

    let dispute = &mut ctx.accounts.dispute;
    dispute.state = DisputeState::Resolved;

    let tanda = &mut ctx.accounts.tanda;
    if continue_wins {
        tanda.state = TandaState::Active;
    } else {
        // Tie or cancel-majority → cancel for user safety.
        tanda.state = TandaState::Cancelled;
    }

    emit!(DisputeResolved {
        dispute: dispute.key(),
        continue_tanda: continue_wins,
        timestamp: now,
    });

    Ok(())
}
