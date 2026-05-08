use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum DisputeState {
    Open,
    Resolved,
    Expired,
}

#[account]
#[derive(Debug)]
pub struct Dispute {
    pub tanda: Pubkey,
    pub dispute_id: u8,
    pub opener: Pubkey,
    pub reason_hash: [u8; 32],
    pub opened_at: i64,
    pub deadline_ts: i64,
    pub votes_continue: u8,
    pub votes_cancel: u8,
    pub state: DisputeState,
    pub bump: u8,
}

impl Dispute {
    pub const SIZE: usize = 8 + 32 + 1 + 32 + 32 + 8 + 8 + 1 + 1 + 1 + 1;
}

#[account]
#[derive(Debug)]
pub struct DisputeVote {
    pub dispute: Pubkey,
    pub voter: Pubkey,
    pub continue_tanda: bool,
    pub voted_at: i64,
    pub bump: u8,
}

impl DisputeVote {
    pub const SIZE: usize = 8 + 32 + 32 + 1 + 8 + 1;
}
