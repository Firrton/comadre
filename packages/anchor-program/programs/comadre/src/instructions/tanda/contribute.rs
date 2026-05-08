use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::constants::{SEED_CONFIG, SEED_MEMBER};
use crate::errors::ComadreError;
use crate::events::ContributionMade;
use crate::state::{Member, ProgramConfig, Tanda, TandaState};

#[derive(Accounts)]
pub struct Contribute<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_MEMBER, tanda.key().as_ref(), user.key().as_ref()],
        bump = member.bump,
    )]
    pub member: Account<'info, Member>,

    #[account(mut)]
    pub tanda: Account<'info, Tanda>,

    #[account(
        seeds = [SEED_CONFIG],
        bump = program_config.bump,
    )]
    pub program_config: Account<'info, ProgramConfig>,

    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = user,
    )]
    pub user_usdc_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        address = tanda.vault @ ComadreError::Unauthorized,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(address = tanda.usdc_mint @ ComadreError::Unauthorized)]
    pub usdc_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<Contribute>) -> Result<()> {
    let config = &ctx.accounts.program_config;

    // ── Global pause guard ──────────────────────────────────────────────────
    require!(!config.paused, ComadreError::ProgramPaused);

    let tanda = &ctx.accounts.tanda;
    let member = &ctx.accounts.member;

    // ── State checks ────────────────────────────────────────────────────────
    require!(
        tanda.state == TandaState::Active,
        ComadreError::TandaNotActive
    );
    require!(member.is_active, ComadreError::MemberInactive);

    // Already contributed this turn if contributions_made >= current_turn.
    // (contributions_made is 0-based count; current_turn is 1-based)
    require!(
        member.contributions_made < tanda.current_turn,
        ComadreError::AlreadyContributed
    );

    // ── Transfer contribution from user → vault ─────────────────────────────
    let contribution_amount = tanda.contribution_amount;
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.user_usdc_ata.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        },
    );
    token::transfer(cpi_ctx, contribution_amount)?;

    // ── Update member state ─────────────────────────────────────────────────
    let now = Clock::get()?.unix_timestamp;
    let tanda_key = ctx.accounts.tanda.key();
    let user_key = ctx.accounts.user.key();
    let current_turn = ctx.accounts.tanda.current_turn;
    let member = &mut ctx.accounts.member;
    member.contributions_made = member
        .contributions_made
        .checked_add(1)
        .ok_or(ComadreError::MathOverflow)?;
    member.last_contribution_ts = now;

    // ── Track per-turn contribution count on tanda ──────────────────────────
    let tanda = &mut ctx.accounts.tanda;
    tanda.contributions_this_turn = tanda
        .contributions_this_turn
        .checked_add(1)
        .ok_or(ComadreError::MathOverflow)?;

    emit!(ContributionMade {
        tanda: tanda_key,
        user: user_key,
        turn: current_turn,
        amount: contribution_amount,
        timestamp: now,
    });

    Ok(())
}
