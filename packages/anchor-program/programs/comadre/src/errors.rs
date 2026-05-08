use anchor_lang::prelude::*;

#[error_code]
pub enum ComadreError {
    #[msg("Insufficient KYC tier for this action")]
    InsufficientKyc,
    #[msg("Tanda is not in Forming state")]
    TandaNotForming,
    #[msg("Tanda is not Active")]
    TandaNotActive,
    #[msg("Tanda is paused due to dispute")]
    TandaPaused,
    #[msg("Tanda is full")]
    TandaFull,
    #[msg("Tanda member count must be between 3 and 20")]
    InvalidMemberCount,
    #[msg("Turn number already taken")]
    TurnAlreadyTaken,
    #[msg("Member has already contributed this turn")]
    AlreadyContributed,
    #[msg("Payout time has not been reached")]
    PayoutNotReady,
    #[msg("All members must contribute before payout")]
    MissingContributions,
    #[msg("Dispute voting window has not closed")]
    DisputeStillOpen,
    #[msg("User has already voted on this dispute")]
    AlreadyVoted,
    #[msg("Caller is not a member of this tanda")]
    NotAMember,
    #[msg("Caller is not the tanda creator")]
    NotCreator,
    #[msg("Caller is not authorized")]
    Unauthorized,
    #[msg("Program is paused")]
    ProgramPaused,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Stake amount must be greater than zero")]
    InvalidStake,
    #[msg("fee_bps must be <= 10000 (100%)")]
    InvalidFeeBps,
    #[msg("kyc_limits[0] must be > 0 and the array must be monotonic non-decreasing")]
    InvalidKycLimits,
    #[msg("frequency_seconds must be at least 86400 (24 hours)")]
    InvalidFrequency,
    #[msg("KYC tier insufficient for the requested contribution + stake amount")]
    KycInsufficientForAmount,
    #[msg("Member is not active (slashed)")]
    MemberInactive,
    #[msg("Beneficiary has already received their payout")]
    AlreadyPaidOut,
    #[msg("Payout order mode not yet implemented; use JoinOrder")]
    NotImplemented,
}
