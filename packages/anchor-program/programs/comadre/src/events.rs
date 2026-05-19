use anchor_lang::prelude::*;

#[event]
pub struct UserProfileInitialized {
    pub wallet: Pubkey,
    pub phone_hash: [u8; 32],
    pub country_code: [u8; 2],
    pub timestamp: i64,
}

#[event]
pub struct KycTierUpdated {
    pub wallet: Pubkey,
    pub new_tier: u8,
    pub timestamp: i64,
}

#[event]
pub struct TandaCreated {
    pub tanda: Pubkey,
    pub creator: Pubkey,
    pub member_target: u8,
    pub contribution_amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct MemberJoined {
    pub tanda: Pubkey,
    pub user: Pubkey,
    pub turn_number: u8,
    pub timestamp: i64,
}

#[event]
pub struct TandaStarted {
    pub tanda: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct ContributionMade {
    pub tanda: Pubkey,
    pub user: Pubkey,
    pub turn: u8,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct PayoutExecuted {
    pub tanda: Pubkey,
    pub beneficiary: Pubkey,
    pub turn: u8,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct TandaCompleted {
    pub tanda: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct MemberSlashed {
    pub tanda: Pubkey,
    pub member: Pubkey,
    pub stake_lost: u64,
    pub timestamp: i64,
}

#[event]
pub struct DisputeOpened {
    pub dispute: Pubkey,
    pub tanda: Pubkey,
    pub opener: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct DisputeVoted {
    pub dispute: Pubkey,
    pub voter: Pubkey,
    pub continue_tanda: bool,
    pub timestamp: i64,
}

#[event]
pub struct DisputeResolved {
    pub dispute: Pubkey,
    pub continue_tanda: bool,
    pub timestamp: i64,
}

#[event]
pub struct BadgeMinted {
    pub user: Pubkey,
    pub badge_type: u8,
    pub source: Pubkey,
    pub value: u64,
    pub timestamp: i64,
}

#[event]
pub struct ProgramPauseStateChanged {
    pub paused: bool,
    pub admin: Pubkey,
    pub timestamp: i64,
}
