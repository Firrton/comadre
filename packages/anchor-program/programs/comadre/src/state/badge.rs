use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum BadgeType {
    TandaCompleted,
    TandaCreatedAndCompleted,
    LoanRepaidOnTime,
    DisputeResolvedFairly,
}

#[account]
#[derive(Debug)]
pub struct ReputationBadge {
    pub user: Pubkey,
    pub badge_id: u64,
    pub badge_type: BadgeType,
    pub source_account: Pubkey,
    pub value: u64,
    pub earned_at: i64,
    pub bump: u8,
}

impl ReputationBadge {
    pub const SIZE: usize = 8 + 32 + 8 + 1 + 32 + 8 + 8 + 1;
}
