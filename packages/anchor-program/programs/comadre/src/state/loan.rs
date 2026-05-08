use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum LoanState {
    Pending,
    Active,
    Repaid,
    Defaulted,
}

#[account]
#[derive(Debug)]
pub struct Loan {
    pub borrower: Pubkey,
    pub loan_id: u64,
    pub tanda_backing: Pubkey,
    pub principal: u64,
    pub apr_bps: u16,
    pub total_repaid: u64,
    pub disbursed_at: i64,
    pub due_ts: i64,
    pub cosigner_count: u8,
    pub cosigners_signed: u8,
    pub state: LoanState,
    pub bump: u8,
}

impl Loan {
    pub const SIZE: usize = 8 + 32 + 8 + 32 + 8 + 2 + 8 + 8 + 8 + 1 + 1 + 1 + 1;
}

#[account]
#[derive(Debug)]
pub struct LoanCosigner {
    pub loan: Pubkey,
    pub cosigner: Pubkey,
    pub stake_locked: u64,
    pub has_signed: bool,
    pub signed_at: i64,
    pub bump: u8,
}

impl LoanCosigner {
    pub const SIZE: usize = 8 + 32 + 32 + 8 + 1 + 8 + 1;
}
