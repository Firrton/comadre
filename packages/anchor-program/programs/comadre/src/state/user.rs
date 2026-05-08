use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum KycTier {
    T0Demo,
    T1Lite,
    T2Standard,
    T3Pro,
}

#[account]
#[derive(Debug)]
pub struct UserProfile {
    pub wallet: Pubkey,
    pub phone_hash: [u8; 32],
    pub country_code: [u8; 2],
    pub kyc_tier: KycTier,
    pub reputation_score: u32,
    pub tandas_completed: u16,
    pub tandas_defaulted: u16,
    pub tandas_created: u64,
    pub loans_repaid: u16,
    pub loans_defaulted: u16,
    pub created_at: i64,
    pub bump: u8,
}

impl UserProfile {
    pub const SIZE: usize = 8 + 32 + 32 + 2 + 1 + 4 + 2 + 2 + 8 + 2 + 2 + 8 + 1;
}
