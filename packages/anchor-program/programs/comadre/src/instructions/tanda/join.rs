use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::constants::{SEED_CONFIG, SEED_MEMBER, SEED_USER};
use crate::errors::ComadreError;
use crate::events::MemberJoined;
use crate::state::{Member, PayoutOrder, ProgramConfig, Tanda, TandaState, UserProfile};

#[derive(Accounts)]
pub struct JoinTanda<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [SEED_USER, user.key().as_ref()],
        bump = user_profile.bump,
    )]
    pub user_profile: Account<'info, UserProfile>,

    #[account(
        seeds = [SEED_CONFIG],
        bump = program_config.bump,
    )]
    pub program_config: Account<'info, ProgramConfig>,

    /// The tanda to join — must be in Forming state.
    #[account(mut)]
    pub tanda: Account<'info, Tanda>,

    /// Member PDA — created here.
    #[account(
        init,
        payer = user,
        space = Member::SIZE,
        seeds = [SEED_MEMBER, tanda.key().as_ref(), user.key().as_ref()],
        bump,
    )]
    pub member: Account<'info, Member>,

    /// User's USDC token account (source of stake transfer).
    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = user,
    )]
    pub user_usdc_ata: Account<'info, TokenAccount>,

    /// Vault — must be the one stored in tanda.vault.
    #[account(
        mut,
        address = tanda.vault @ ComadreError::Unauthorized,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(address = tanda.usdc_mint @ ComadreError::Unauthorized)]
    pub usdc_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<JoinTanda>, turn_number: u8) -> Result<()> {
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
        tanda.member_current < tanda.member_target,
        ComadreError::TandaFull
    );

    // ── KYC amount limit check ──────────────────────────────────────────────
    // kyc_limits[tier] is the max total tokens this tier can hold in a single tanda.
    // We use contribution_amount + stake_amount as a proxy for exposure.
    let required_amount = tanda
        .contribution_amount
        .checked_add(tanda.stake_amount)
        .ok_or(ComadreError::MathOverflow)?;
    let kyc_tier_idx = ctx.accounts.user_profile.kyc_tier as usize;
    require!(
        config.kyc_limits[kyc_tier_idx] >= required_amount,
        ComadreError::KycInsufficientForAmount
    );

    // ── Resolve turn number ─────────────────────────────────────────────────
    // JoinOrder: turn = current member count + 1 (1-based)
    // CreatorSet: use the caller-supplied turn_number
    // Random: placeholder (turn is assigned at start_tanda via slot-based shuffle);
    //         for now store the supplied value; start_tanda will overwrite it.
    let assigned_turn = match tanda.payout_order_mode {
        PayoutOrder::JoinOrder => tanda
            .member_current
            .checked_add(1)
            .ok_or(ComadreError::MathOverflow)?,
        PayoutOrder::CreatorSet | PayoutOrder::Random => turn_number,
    };

    // ── Transfer stake from user → vault ────────────────────────────────────
    let stake_amount = tanda.stake_amount;
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.user_usdc_ata.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        },
    );
    token::transfer(cpi_ctx, stake_amount)?;

    // ── Initialise Member account ───────────────────────────────────────────
    let now = Clock::get()?.unix_timestamp;
    let tanda_key = ctx.accounts.tanda.key();
    let user_key = ctx.accounts.user.key();
    let member = &mut ctx.accounts.member;

    member.tanda = tanda_key;
    member.user = user_key;
    member.turn_number = assigned_turn;
    member.contributions_made = 0;
    member.last_contribution_ts = 0;
    member.stake_locked = stake_amount;
    member.is_active = true;
    member.has_received_payout = false;
    member.joined_at = now;
    member.bump = ctx.bumps.member;

    // ── Advance member count ────────────────────────────────────────────────
    let tanda = &mut ctx.accounts.tanda;
    tanda.member_current = tanda
        .member_current
        .checked_add(1)
        .ok_or(ComadreError::MathOverflow)?;

    emit!(MemberJoined {
        tanda: tanda_key,
        user: user_key,
        turn_number: assigned_turn,
        timestamp: now,
    });

    Ok(())
}
