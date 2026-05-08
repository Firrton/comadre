use anchor_lang::prelude::*;

use crate::constants::{
    DISPUTE_VOTING_WINDOW_SECONDS, MAX_DISPUTES_PER_TANDA, SEED_CONFIG, SEED_DISPUTE, SEED_MEMBER,
};
use crate::errors::ComadreError;
use crate::events::DisputeOpened;
use crate::state::{Dispute, DisputeState, Member, ProgramConfig, Tanda, TandaState};

#[derive(Accounts)]
#[instruction(reason_hash: [u8; 32])]
pub struct OpenDispute<'info> {
    #[account(mut)]
    pub opener: Signer<'info>,

    /// Opener's membership PDA for this tanda — proves they are an active member.
    #[account(
        seeds = [SEED_MEMBER, tanda.key().as_ref(), opener.key().as_ref()],
        bump = opener_member.bump,
    )]
    pub opener_member: Account<'info, Member>,

    #[account(mut)]
    pub tanda: Account<'info, Tanda>,

    #[account(
        seeds = [SEED_CONFIG],
        bump = program_config.bump,
    )]
    pub program_config: Account<'info, ProgramConfig>,

    /// Dispute PDA — initialised here.
    /// dispute_id = tanda.disputes_opened (before increment).
    #[account(
        init,
        payer = opener,
        space = Dispute::SIZE,
        seeds = [SEED_DISPUTE, tanda.key().as_ref(), &[tanda.disputes_opened]],
        bump,
    )]
    pub dispute: Account<'info, Dispute>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<OpenDispute>, reason_hash: [u8; 32]) -> Result<()> {
    let config = &ctx.accounts.program_config;

    // ── Global pause guard ──────────────────────────────────────────────────
    require!(!config.paused, ComadreError::ProgramPaused);

    let tanda = &ctx.accounts.tanda;

    // ── Tanda must be Active to open a dispute ──────────────────────────────
    require!(tanda.state == TandaState::Active, ComadreError::TandaNotActive);

    // ── Opener must be an active member ────────────────────────────────────
    let opener_member = &ctx.accounts.opener_member;
    require!(
        opener_member.tanda == tanda.key(),
        ComadreError::NotAMember
    );
    require!(opener_member.is_active, ComadreError::NotAMember);

    // ── Cap at MAX_DISPUTES_PER_TANDA ───────────────────────────────────────
    require!(
        tanda.disputes_opened < MAX_DISPUTES_PER_TANDA,
        ComadreError::MaxDisputesReached
    );

    let now = Clock::get()?.unix_timestamp;
    let dispute_id = tanda.disputes_opened;

    // ── Initialise Dispute account ──────────────────────────────────────────
    let dispute = &mut ctx.accounts.dispute;
    dispute.tanda = ctx.accounts.tanda.key();
    dispute.dispute_id = dispute_id;
    dispute.opener = ctx.accounts.opener.key();
    dispute.reason_hash = reason_hash;
    dispute.opened_at = now;
    dispute.deadline_ts = now
        .checked_add(DISPUTE_VOTING_WINDOW_SECONDS)
        .ok_or(ComadreError::MathOverflow)?;
    dispute.votes_continue = 0;
    dispute.votes_cancel = 0;
    dispute.state = DisputeState::Open;
    dispute.bump = ctx.bumps.dispute;

    // ── Pause tanda and increment dispute counter ───────────────────────────
    let tanda = &mut ctx.accounts.tanda;
    tanda.state = TandaState::Paused;
    tanda.disputes_opened = tanda
        .disputes_opened
        .checked_add(1)
        .ok_or(ComadreError::MathOverflow)?;

    emit!(DisputeOpened {
        dispute: dispute.key(),
        tanda: tanda.key(),
        opener: ctx.accounts.opener.key(),
        timestamp: now,
    });

    Ok(())
}
