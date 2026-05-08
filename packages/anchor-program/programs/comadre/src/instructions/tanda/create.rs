use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::{MAX_MEMBERS, SEED_CONFIG, SEED_TANDA, SEED_USER, SEED_VAULT};
use crate::errors::ComadreError;
use crate::events::TandaCreated;
use crate::state::{KycTier, PayoutOrder, ProgramConfig, Tanda, TandaState, UserProfile};

// ── Minimum frequency: 24 hours ────────────────────────────────────────────
const MIN_FREQUENCY_SECONDS: u32 = 86_400;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CreateTandaParams {
    pub tanda_id: u64,
    pub name_hash: [u8; 32],
    pub member_target: u8,
    pub contribution_amount: u64,
    pub stake_amount: u64,
    pub frequency_seconds: u32,
    pub payout_order_mode: PayoutOrder,
}

#[derive(Accounts)]
#[instruction(params: CreateTandaParams)]
pub struct CreateTanda<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    /// Creator must have an initialised profile so we can check their KYC tier.
    #[account(
        seeds = [SEED_USER, creator.key().as_ref()],
        bump = creator_profile.bump,
    )]
    pub creator_profile: Account<'info, UserProfile>,

    /// Singleton config — reject if program is paused.
    #[account(
        seeds = [SEED_CONFIG],
        bump = program_config.bump,
    )]
    pub program_config: Account<'info, ProgramConfig>,

    /// Tanda PDA — created here.
    #[account(
        init,
        payer = creator,
        space = Tanda::SIZE,
        seeds = [SEED_TANDA, creator.key().as_ref(), &params.tanda_id.to_le_bytes()],
        bump,
    )]
    pub tanda: Account<'info, Tanda>,

    /// Vault token account (PDA-owned, authority = tanda PDA).
    #[account(
        init,
        payer = creator,
        token::mint = usdc_mint,
        token::authority = tanda,
        seeds = [SEED_VAULT, tanda.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// The token mint for this tanda.
    /// On localnet (feature = "localnet") any mint is accepted so tests can use
    /// fresh mints without a canonical USDC deployment.  On mainnet/devnet the
    /// mint is verified in-handler against program_config.usdc_mint.
    pub usdc_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<CreateTanda>, params: CreateTandaParams) -> Result<()> {
    let config = &ctx.accounts.program_config;

    // ── Global pause guard ──────────────────────────────────────────────────
    require!(!config.paused, ComadreError::ProgramPaused);

    // ── USDC mint guard (skipped on localnet to allow fresh test mints) ─────
    #[cfg(not(feature = "localnet"))]
    require!(
        ctx.accounts.usdc_mint.key() == config.usdc_mint,
        ComadreError::Unauthorized
    );

    // ── Parameter validation ────────────────────────────────────────────────
    require!(
        params.member_target >= 3 && params.member_target as usize <= MAX_MEMBERS,
        ComadreError::InvalidMemberCount
    );
    require!(params.contribution_amount > 0, ComadreError::InvalidStake);
    require!(params.stake_amount > 0, ComadreError::InvalidStake);
    // On devnet/mainnet enforce the 24-hour minimum.
    // On localnet/tests we allow shorter intervals so payout tests don't need clock manipulation.
    #[cfg(not(feature = "localnet"))]
    require!(
        params.frequency_seconds >= MIN_FREQUENCY_SECONDS,
        ComadreError::InvalidFrequency
    );

    // ── KYC tier check — creator must be at least T1Lite ───────────────────
    // T0Demo is only usable in demos; real on-chain tandas require T1Lite+.
    let kyc_tier_u8 = ctx.accounts.creator_profile.kyc_tier as u8;
    require!(
        kyc_tier_u8 >= KycTier::T1Lite as u8,
        ComadreError::InsufficientKyc
    );

    // ── Initialise Tanda account ────────────────────────────────────────────
    let now = Clock::get()?.unix_timestamp;
    let tanda = &mut ctx.accounts.tanda;

    tanda.creator = ctx.accounts.creator.key();
    tanda.tanda_id = params.tanda_id;
    tanda.name_hash = params.name_hash;
    tanda.usdc_mint = ctx.accounts.usdc_mint.key();
    tanda.vault = ctx.accounts.vault.key();
    tanda.member_target = params.member_target;
    tanda.member_current = 0;
    tanda.contribution_amount = params.contribution_amount;
    tanda.stake_amount = params.stake_amount;
    tanda.frequency_seconds = params.frequency_seconds;
    tanda.total_turns = params.member_target; // one turn per member
    tanda.current_turn = 0;
    tanda.contributions_this_turn = 0;
    tanda.state = TandaState::Forming;
    tanda.payout_order_mode = params.payout_order_mode;
    tanda.next_payout_ts = 0;
    tanda.started_at = 0;
    tanda.created_at = now;
    tanda.bump = ctx.bumps.tanda;
    tanda.vault_bump = ctx.bumps.vault;

    emit!(TandaCreated {
        tanda: tanda.key(),
        creator: ctx.accounts.creator.key(),
        member_target: params.member_target,
        contribution_amount: params.contribution_amount,
        timestamp: now,
    });

    Ok(())
}
