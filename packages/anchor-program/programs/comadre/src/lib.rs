use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("BfVXncFhJdSsDciLx7UzVjFbEBw1EtcnJCsYSRis54Sh");

#[program]
pub mod comadre {
    use super::*;

    // ===== User =====
    pub fn init_user_profile(
        ctx: Context<InitUserProfile>,
        phone_hash: [u8; 32],
        country_code: [u8; 2],
    ) -> Result<()> {
        instructions::user::init_profile::handler(ctx, phone_hash, country_code)
    }

    pub fn update_kyc_tier(
        ctx: Context<UpdateKycTier>,
        new_tier: state::KycTier,
    ) -> Result<()> {
        instructions::user::update_kyc::handler(ctx, new_tier)
    }

    // ===== Tanda lifecycle =====
    pub fn create_tanda(
        ctx: Context<CreateTanda>,
        params: CreateTandaParams,
    ) -> Result<()> {
        instructions::tanda::create::handler(ctx, params)
    }

    pub fn join_tanda(ctx: Context<JoinTanda>, turn_number: u8) -> Result<()> {
        instructions::tanda::join::handler(ctx, turn_number)
    }

    pub fn start_tanda(ctx: Context<StartTanda>) -> Result<()> {
        instructions::tanda::start::handler(ctx)
    }

    pub fn contribute(ctx: Context<Contribute>) -> Result<()> {
        instructions::tanda::contribute::handler(ctx)
    }

    pub fn payout(ctx: Context<Payout>) -> Result<()> {
        instructions::tanda::payout::handler(ctx)
    }

    pub fn slash_defaulter(ctx: Context<SlashDefaulter>) -> Result<()> {
        instructions::tanda::slash::handler(ctx)
    }

    pub fn complete_tanda(ctx: Context<CompleteTanda>) -> Result<()> {
        instructions::tanda::complete::handler(ctx)
    }

    // ===== Disputes =====
    pub fn open_dispute(ctx: Context<OpenDispute>, reason_hash: [u8; 32]) -> Result<()> {
        instructions::dispute::open::handler(ctx, reason_hash)
    }

    pub fn vote_dispute(ctx: Context<VoteDispute>, continue_tanda: bool) -> Result<()> {
        instructions::dispute::vote::handler(ctx, continue_tanda)
    }

    pub fn resolve_dispute(ctx: Context<ResolveDispute>) -> Result<()> {
        instructions::dispute::resolve::handler(ctx)
    }

    // ===== Admin =====
    pub fn init_config(ctx: Context<InitConfig>, params: InitConfigParams) -> Result<()> {
        instructions::admin::init_config::handler(ctx, params)
    }

    pub fn pause(ctx: Context<Pause>, paused: bool) -> Result<()> {
        instructions::admin::pause::handler(ctx, paused)
    }
}
