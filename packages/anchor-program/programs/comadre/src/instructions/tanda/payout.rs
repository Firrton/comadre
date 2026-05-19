use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::constants::{SEED_CONFIG, SEED_TANDA, SEED_VAULT};
use crate::errors::ComadreError;
use crate::events::{PayoutExecuted, TandaCompleted};
use crate::state::{Member, ProgramConfig, Tanda, TandaState};

#[derive(Accounts)]
pub struct Payout<'info> {
    /// Must equal program_config.crank_authority.
    pub crank: Signer<'info>,

    #[account(mut)]
    pub tanda: Account<'info, Tanda>,

    #[account(
        seeds = [SEED_CONFIG],
        bump = program_config.bump,
    )]
    pub program_config: Account<'info, ProgramConfig>,

    /// The member whose turn it is to receive the payout.
    /// Validated in-handler: beneficiary_member.tanda == tanda.key()
    ///                        beneficiary_member.turn_number == tanda.current_turn
    #[account(mut)]
    pub beneficiary_member: Account<'info, Member>,

    /// Beneficiary's USDC token account.
    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = beneficiary_member.user,
    )]
    pub beneficiary_usdc_ata: Account<'info, TokenAccount>,

    /// Vault — PDA-owned by the tanda account. The CPI will use the tanda PDA as signer.
    #[account(
        mut,
        address = tanda.vault @ ComadreError::Unauthorized,
        seeds = [SEED_VAULT, tanda.key().as_ref()],
        bump = tanda.vault_bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(address = tanda.usdc_mint @ ComadreError::Unauthorized)]
    pub usdc_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<Payout>) -> Result<()> {
    let config = &ctx.accounts.program_config;

    // ── Crank-authority guard ───────────────────────────────────────────────
    require!(
        ctx.accounts.crank.key() == config.crank_authority,
        ComadreError::Unauthorized
    );

    // ── Global pause guard ──────────────────────────────────────────────────
    require!(!config.paused, ComadreError::ProgramPaused);

    let tanda = &ctx.accounts.tanda;

    // ── State checks ────────────────────────────────────────────────────────
    require!(
        tanda.state == TandaState::Active,
        ComadreError::TandaNotActive
    );

    let now = Clock::get()?.unix_timestamp;
    require!(now >= tanda.next_payout_ts, ComadreError::PayoutNotReady);

    // ── Beneficiary validation ──────────────────────────────────────────────
    let beneficiary_member = &ctx.accounts.beneficiary_member;
    require!(
        beneficiary_member.tanda == tanda.key(),
        ComadreError::NotAMember
    );
    require!(
        beneficiary_member.turn_number == tanda.current_turn,
        ComadreError::NotAMember
    );

    // ── Belt-and-suspenders: reject double payout ───────────────────────────
    require!(
        !beneficiary_member.has_received_payout,
        ComadreError::AlreadyPaidOut
    );

    // ── All-contributions guard ─────────────────────────────────────────────
    // Prevents a compromised or buggy crank from draining the vault before all
    // members have contributed for the current turn.
    require!(
        tanda.contributions_this_turn == tanda.member_target,
        ComadreError::MissingContributions
    );

    // ── Payout amount ───────────────────────────────────────────────────────
    // Convention: every member — including the beneficiary — contributes their
    // own turn. The beneficiary receives the FULL pot of N × contribution_amount.
    // This is the standard Mexican tanda convention: everyone contributes every
    // turn regardless of whose turn it is to receive.
    let contribution_amount = tanda.contribution_amount;
    let member_target = tanda.member_target;
    let payout_amount = contribution_amount
        .checked_mul(member_target as u64)
        .ok_or(ComadreError::MathOverflow)?;

    // ── PDA signer seeds for vault authority CPI ────────────────────────────
    // Vault authority = tanda PDA.
    // Seeds: [SEED_TANDA, creator.as_ref(), tanda_id_le_bytes, bump]
    let creator_key = tanda.creator;
    let tanda_id_bytes = tanda.tanda_id.to_le_bytes();
    let tanda_bump_arr = [tanda.bump];
    let turn_paid = tanda.current_turn;

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
            to: ctx.accounts.beneficiary_usdc_ata.to_account_info(),
            authority: ctx.accounts.tanda.to_account_info(),
        },
        &signer_seeds_outer,
    );
    token::transfer(cpi_ctx, payout_amount)?;

    // ── Update beneficiary member ───────────────────────────────────────────
    let beneficiary_user = ctx.accounts.beneficiary_member.user;
    let beneficiary_member = &mut ctx.accounts.beneficiary_member;
    beneficiary_member.has_received_payout = true;

    // ── Advance tanda turn / maybe complete ────────────────────────────────
    let tanda = &mut ctx.accounts.tanda;

    // Reset per-turn contribution counter for the next turn.
    tanda.contributions_this_turn = 0;
    let next_turn = tanda
        .current_turn
        .checked_add(1)
        .ok_or(ComadreError::MathOverflow)?;

    if next_turn > tanda.total_turns {
        // All turns exhausted — transition to Completed.
        tanda.state = TandaState::Completed;
        tanda.current_turn = next_turn; // update so complete_tanda guard passes
        emit!(TandaCompleted {
            tanda: tanda.key(),
            timestamp: now,
        });
    } else {
        tanda.current_turn = next_turn;
        // Anchor to the previous schedule slot, not to `now`, to prevent drift.
        let previous_ts = tanda.next_payout_ts;
        tanda.next_payout_ts = previous_ts
            .checked_add(tanda.frequency_seconds as i64)
            .ok_or(ComadreError::MathOverflow)?;
    }

    emit!(PayoutExecuted {
        tanda: tanda.key(),
        beneficiary: beneficiary_user,
        turn: turn_paid,
        amount: payout_amount,
        timestamp: now,
    });

    Ok(())
}
