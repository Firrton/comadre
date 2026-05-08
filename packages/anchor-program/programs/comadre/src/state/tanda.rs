use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum TandaState {
    Forming,
    Active,
    Paused,
    Completed,
    Cancelled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum PayoutOrder {
    JoinOrder,
    CreatorSet,
    Random,
}

#[account]
#[derive(Debug)]
pub struct Tanda {
    pub creator: Pubkey,
    pub tanda_id: u64,
    pub name_hash: [u8; 32],
    pub usdc_mint: Pubkey,
    pub vault: Pubkey,
    pub member_target: u8,
    pub member_current: u8,
    pub contribution_amount: u64,
    pub stake_amount: u64,
    pub frequency_seconds: u32,
    pub total_turns: u8,
    pub current_turn: u8,
    /// Running count of contributions received for the current turn.
    /// Incremented by `contribute`, reset to 0 after each `payout`.
    pub contributions_this_turn: u8,
    /// Running count of disputes opened against this tanda (max 5).
    pub disputes_opened: u8,
    pub state: TandaState,
    pub payout_order_mode: PayoutOrder,
    pub next_payout_ts: i64,
    pub started_at: i64,
    pub created_at: i64,
    pub bump: u8,
    pub vault_bump: u8,
}

impl Tanda {
    // discriminator(8) + creator(32) + tanda_id(8) + name_hash(32) + usdc_mint(32) + vault(32)
    // + member_target(1) + member_current(1) + contribution_amount(8) + stake_amount(8)
    // + frequency_seconds(4) + total_turns(1) + current_turn(1) + contributions_this_turn(1)
    // + disputes_opened(1) + state(1) + payout_order_mode(1) + next_payout_ts(8)
    // + started_at(8) + created_at(8) + bump(1) + vault_bump(1) = 152
    pub const SIZE: usize =
        8 + 32 + 8 + 32 + 32 + 32 + 1 + 1 + 8 + 8 + 4 + 1 + 1 + 1 + 1 + 1 + 1 + 8 + 8 + 8 + 1 + 1;
}

#[account]
#[derive(Debug)]
pub struct Member {
    pub tanda: Pubkey,
    pub user: Pubkey,
    pub turn_number: u8,
    pub contributions_made: u8,
    pub last_contribution_ts: i64,
    pub stake_locked: u64,
    pub is_active: bool,
    pub has_received_payout: bool,
    pub joined_at: i64,
    pub bump: u8,
}

impl Member {
    pub const SIZE: usize = 8 + 32 + 32 + 1 + 1 + 8 + 8 + 1 + 1 + 8 + 1;
}
