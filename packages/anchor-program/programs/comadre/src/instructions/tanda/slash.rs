use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::{SEED_CONFIG, SEED_TANDA, SEED_VAULT, SLASH_GRACE_SECONDS};
use crate::errors::ComadreError;
use crate::events::MemberSlashed;
use crate::state::{Member, ProgramConfig, Tanda, TandaState};

#[derive(Accounts)]
pub struct SlashDefaulter<'info> {
    /// Must equal program_config.crank_authority.
    pub crank: Signer<'info>,

    #[account(mut)]
    pub tanda: Account<'info, Tanda>,

    /// The member to slash. Validated in-handler:
    ///   - defaulter_member.tanda == tanda.key()
    ///   - defaulter_member.is_active
    ///   - has missed current turn contribution past grace period
    #[account(mut)]
    pub defaulter_member: Account<'info, Member>,

    #[account(
        seeds = [SEED_CONFIG],
        bump = program_config.bump,
    )]
    pub program_config: Account<'info, ProgramConfig>,

    /// Vault PDA — source of the slashed stake.
    #[account(
        mut,
        address = tanda.vault @ ComadreError::Unauthorized,
        seeds = [SEED_VAULT, tanda.key().as_ref()],
        bump = tanda.vault_bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// Treasury destination for slashed stake — must be owned by program_config.fee_destination.
    #[account(
        mut,
        token::mint = tanda.usdc_mint,
        token::authority = program_config.fee_destination,
    )]
    pub fee_destination_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<SlashDefaulter>) -> Result<()> {
    let config = &ctx.accounts.program_config;

    // ── Global pause guard ──────────────────────────────────────────────────
    require!(!config.paused, ComadreError::ProgramPaused);

    // ── Crank-authority guard ───────────────────────────────────────────────
    require!(
        ctx.accounts.crank.key() == config.crank_authority,
        ComadreError::Unauthorized
    );

    let tanda = &ctx.accounts.tanda;

    // ── Tanda must be Active ────────────────────────────────────────────────
    require!(tanda.state == TandaState::Active, ComadreError::TandaNotActive);

    let defaulter = &ctx.accounts.defaulter_member;

    // ── Member must belong to this tanda ───────────────────────────────────
    require!(
        defaulter.tanda == tanda.key(),
        ComadreError::NotAMember
    );

    // ── Member must still be active ────────────────────────────────────────
    require!(defaulter.is_active, ComadreError::MemberInactive);

    // ── Default condition: missed contribution for current turn AND grace elapsed ──
    // contributions_made < current_turn means they have not yet contributed this turn.
    // clock.now > next_payout_ts + SLASH_GRACE_SECONDS means the grace period is over.
    let now = Clock::get()?.unix_timestamp;
    let grace_deadline = tanda
        .next_payout_ts
        .checked_add(SLASH_GRACE_SECONDS)
        .ok_or(ComadreError::MathOverflow)?;

    require!(
        defaulter.contributions_made < tanda.current_turn && now > grace_deadline,
        ComadreError::MemberNotDefaulted
    );

    let slash_amount = defaulter.stake_locked;
    let tanda_key = ctx.accounts.tanda.key();
    let defaulter_key = ctx.accounts.defaulter_member.user;

    // ── CPI: transfer stake from vault → fee_destination (signed by tanda PDA) ──
    let creator_key = tanda.creator;
    let tanda_id_bytes = tanda.tanda_id.to_le_bytes();
    let tanda_bump_arr = [tanda.bump];

    let tanda_signer: &[&[u8]] = &[
        SEED_TANDA,
        creator_key.as_ref(),
        &tanda_id_bytes,
        &tanda_bump_arr,
    ];
    let signer_seeds_outer = [tanda_signer];

    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.fee_destination_ata.to_account_info(),
            authority: ctx.accounts.tanda.to_account_info(),
        },
        &signer_seeds_outer,
    );
    token::transfer(cpi_ctx, slash_amount)?;

    // ── Update member state ─────────────────────────────────────────────────
    let defaulter_member = &mut ctx.accounts.defaulter_member;
    defaulter_member.is_active = false;
    defaulter_member.stake_locked = 0;

    // ── Decrement active member count on tanda ──────────────────────────────
    let tanda = &mut ctx.accounts.tanda;
    tanda.member_current = tanda
        .member_current
        .checked_sub(1)
        .ok_or(ComadreError::MathOverflow)?;

    emit!(MemberSlashed {
        tanda: tanda_key,
        member: defaulter_key,
        stake_lost: slash_amount,
        timestamp: now,
    });

    Ok(())
}
