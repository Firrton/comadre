use anchor_lang::prelude::*;

use crate::constants::SEED_CONFIG;
use crate::errors::ComadreError;
use crate::events::TandaStarted;
use crate::state::{ProgramConfig, Tanda, TandaState};

#[derive(Accounts)]
pub struct StartTanda<'info> {
    /// Must be the tanda creator.
    pub creator: Signer<'info>,

    #[account(
        mut,
        has_one = creator @ ComadreError::NotCreator,
    )]
    pub tanda: Account<'info, Tanda>,

    #[account(
        seeds = [SEED_CONFIG],
        bump = program_config.bump,
    )]
    pub program_config: Account<'info, ProgramConfig>,
}

pub fn handler(ctx: Context<StartTanda>) -> Result<()> {
    let config = &ctx.accounts.program_config;

    // ── Global pause guard ──────────────────────────────────────────────────
    require!(!config.paused, ComadreError::ProgramPaused);

    let tanda = &ctx.accounts.tanda;

    // ── State checks ────────────────────────────────────────────────────────
    require!(
        tanda.state == TandaState::Forming,
        ComadreError::TandaNotForming
    );
    require!(
        tanda.member_current == tanda.member_target,
        ComadreError::InvalidMemberCount
    );

    // ── Transition to Active ────────────────────────────────────────────────
    // NOTE (Random payout order): For PayoutOrder::Random we would ideally use
    // Chainlink VRF or a commit-reveal scheme to shuffle turn_numbers across
    // all Member accounts here. Using clock.slot as entropy is NOT secure —
    // validators can influence it. For hackathon scope we accept this limitation
    // and do NOT shuffle. The turn assignments from join_tanda stand as-is.
    // TODO(production): integrate a VRF oracle before enabling Random mode on mainnet.

    let now = Clock::get()?.unix_timestamp;
    let frequency_seconds = tanda.frequency_seconds;
    let tanda = &mut ctx.accounts.tanda;

    tanda.state = TandaState::Active;
    tanda.started_at = now;
    tanda.current_turn = 1;
    tanda.next_payout_ts = now
        .checked_add(frequency_seconds as i64)
        .ok_or(ComadreError::MathOverflow)?;

    emit!(TandaStarted {
        tanda: tanda.key(),
        timestamp: now,
    });

    Ok(())
}
