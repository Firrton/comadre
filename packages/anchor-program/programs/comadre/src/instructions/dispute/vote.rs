use anchor_lang::prelude::*;

use crate::constants::{SEED_CONFIG, SEED_DISPUTE_VOTE, SEED_MEMBER};
use crate::errors::ComadreError;
use crate::events::DisputeVoted;
use crate::state::{Dispute, DisputeState, DisputeVote, Member, ProgramConfig};

#[derive(Accounts)]
#[instruction(continue_tanda: bool)]
pub struct VoteDispute<'info> {
    #[account(mut)]
    pub voter: Signer<'info>,

    /// Voter's membership PDA — proves they are an active member of the tanda under dispute.
    #[account(
        seeds = [SEED_MEMBER, dispute.tanda.as_ref(), voter.key().as_ref()],
        bump = voter_member.bump,
    )]
    pub voter_member: Account<'info, Member>,

    #[account(mut)]
    pub dispute: Account<'info, Dispute>,

    /// DisputeVote PDA — `init` enforces one vote per (dispute, voter) pair.
    /// A second call with the same voter will fail with AccountAlreadyInitialized.
    #[account(
        init,
        payer = voter,
        space = DisputeVote::SIZE,
        seeds = [SEED_DISPUTE_VOTE, dispute.key().as_ref(), voter.key().as_ref()],
        bump,
    )]
    pub dispute_vote: Account<'info, DisputeVote>,

    #[account(
        seeds = [SEED_CONFIG],
        bump = program_config.bump,
    )]
    pub program_config: Account<'info, ProgramConfig>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<VoteDispute>, continue_tanda: bool) -> Result<()> {
    let config = &ctx.accounts.program_config;

    // ── Global pause guard ──────────────────────────────────────────────────
    require!(!config.paused, ComadreError::ProgramPaused);

    let dispute = &ctx.accounts.dispute;

    // ── Dispute must be Open ────────────────────────────────────────────────
    require!(
        dispute.state == DisputeState::Open,
        ComadreError::DisputeNotOpen
    );

    // ── Voting window must not have elapsed ─────────────────────────────────
    let now = Clock::get()?.unix_timestamp;
    require!(now <= dispute.deadline_ts, ComadreError::DisputeExpired);

    // ── Voter must be an active member of the tanda under dispute ───────────
    let voter_member = &ctx.accounts.voter_member;
    require!(
        voter_member.tanda == dispute.tanda,
        ComadreError::NotAMember
    );
    require!(voter_member.is_active, ComadreError::NotAMember);

    // ── Initialise DisputeVote account ──────────────────────────────────────
    let dispute_vote = &mut ctx.accounts.dispute_vote;
    dispute_vote.dispute = ctx.accounts.dispute.key();
    dispute_vote.voter = ctx.accounts.voter.key();
    dispute_vote.continue_tanda = continue_tanda;
    dispute_vote.voted_at = now;
    dispute_vote.bump = ctx.bumps.dispute_vote;

    // ── Tally the vote ──────────────────────────────────────────────────────
    let dispute = &mut ctx.accounts.dispute;
    if continue_tanda {
        dispute.votes_continue = dispute
            .votes_continue
            .checked_add(1)
            .ok_or(ComadreError::MathOverflow)?;
    } else {
        dispute.votes_cancel = dispute
            .votes_cancel
            .checked_add(1)
            .ok_or(ComadreError::MathOverflow)?;
    }

    emit!(DisputeVoted {
        dispute: dispute.key(),
        voter: ctx.accounts.voter.key(),
        continue_tanda,
        timestamp: now,
    });

    Ok(())
}
