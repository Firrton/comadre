// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title ComadreTypes
 * @notice Enums, structs, and constants shared across the Comadre contract.
 *         Mirrors the Anchor program state 1:1 where possible. Storage-packed
 *         per slot for gas-efficiency; do NOT reorder fields without measuring.
 */
library ComadreTypes {
    // -------------------------------------------------------------------------
    // Enums (uint8 on-disk to match Solana's ordinal layout)
    // -------------------------------------------------------------------------

    enum KycTier {
        T0Demo,        // 0 — demo-only; cannot create tandas
        T1Lite,        // 1 — minimum to create
        T2Standard,    // 2
        T3Pro          // 3
    }

    enum TandaState {
        Forming,       // 0 — accepting members
        Active,        // 1 — rounds in progress
        Paused,        // 2 — open dispute
        Completed,     // 3 — all turns paid
        Cancelled      // 4 — resolved by dispute
    }

    enum PayoutOrder {
        JoinOrder,     // 0 — only mode implemented in v1
        CreatorSet,    // 1 — reserved
        Random         // 2 — reserved (needs VRF)
    }

    enum DisputeState {
        Open,          // 0 — voting in progress
        Resolved,      // 1 — closed
        Expired        // 2 — reserved (not currently emitted)
    }

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    /// @notice Hard upper bound on members per tanda. Matches Anchor MAX_MEMBERS.
    uint8 internal constant MAX_MEMBERS = 20;

    /// @notice Hard lower bound on members per tanda.
    uint8 internal constant MIN_MEMBERS = 3;

    /// @notice Maximum disputes that may be opened against a single tanda.
    uint8 internal constant MAX_DISPUTES_PER_TANDA = 5;

    /// @notice Voting window for a dispute (7 days, in seconds).
    uint64 internal constant DISPUTE_VOTING_WINDOW = 604_800;

    /// @notice Grace period after a missed contribution before slash is allowed (24h).
    uint64 internal constant SLASH_GRACE = 86_400;

    /// @notice Minimum frequency between turns on mainnet (24h).
    uint32 internal constant MIN_FREQUENCY = 86_400;

    /// @notice Maximum frequency between turns (90 days). Prevents indefinitely
    ///         long tandas that lock funds for years. See audit LOW-05.
    uint32 internal constant MAX_FREQUENCY = 90 days; // 7_776_000 seconds

    /// @notice Basis-point denominator used in fee math (`fee = gross * feeBps / BPS_DENOMINATOR`).
    ///         100% in basis points; never used as a cap.
    uint16 internal constant BPS_DENOMINATOR = 10_000;

    /// @notice Hard upper bound on `feeBps`. Capped at 3% so a compromised
    ///         admin cannot drain payouts via fee rotation. See audit COM-016.
    uint16 internal constant MAX_FEE_BPS = 300;

    /// @notice Number of KYC tiers (T0–T3).
    uint8 internal constant KYC_TIER_COUNT = 4;

    // -------------------------------------------------------------------------
    // Storage structs
    // -------------------------------------------------------------------------

    /// @notice On-chain user profile keyed by EOA / smart-wallet address.
    ///         Slot-packed: phoneHash (32) | kycTier+exists+flags... (1 slot).
    struct UserProfile {
        bytes32 phoneHash;             // slot 0: full word
        // slot 1 (packed):
        uint8   kycTier;
        bool    exists;
        bytes2  countryCode;
        uint16  tandasCompleted;
        uint16  tandasDefaulted;
        uint16  loansRepaid;
        uint16  loansDefaulted;
        uint64  tandasCreated;
        uint32  reputationScore;
        // slot 2 (packed): createdAt fits in uint64; updatedAt added for indexer parity.
        uint64  createdAt;
    }

    /// @notice Tanda state, keyed by `tandaKey = keccak256(abi.encode(creator, tandaId))`.
    struct Tanda {
        // slot 0: full word — used to identify the tanda for off-chain consumers.
        bytes32 nameHash;
        // slot 1: full word.
        address creator;
        uint64  tandaId;
        // slot 2 (packed): values are USDC amounts (6 decimals); uint128 is comfortable.
        uint128 contributionAmount;
        uint128 stakeAmount;
        // slot 3 (packed): the contract holds vaultBalance for the tanda.
        uint128 vaultBalance;
        // slot 4 (packed): timing + counters.
        uint64  nextPayoutTs;
        uint64  startedAt;
        uint64  createdAt;
        uint32  frequencySeconds;
        // slot 5 (packed): tiny counters + enum bytes + flags.
        uint8   memberTarget;
        uint8   memberCurrent;
        uint8   totalTurns;
        uint8   currentTurn;
        uint8   contributionsThisTurn;
        uint8   disputesOpened;
        TandaState state;
        PayoutOrder payoutOrderMode;
        bool    exists;
    }

    /// @notice Per-(tanda, user) state, keyed by `memberKeyOf(tandaKey, user)`.
    struct Member {
        // slot 0 (packed)
        address user;
        uint64  joinedAt;
        // slot 1 (packed)
        uint128 stakeLocked;
        uint64  lastContributionTs;
        uint8   turnNumber;
        uint8   contributionsMade;
        bool    isActive;
        bool    hasReceivedPayout;
        bool    exists;
    }

    /// @notice Dispute keyed by `disputeKeyOf(tandaKey, disputeId)`.
    struct Dispute {
        // slot 0: full word.
        bytes32 reasonHash;
        // slot 1: full word — binds this dispute to the tanda that created it (CRIT-02).
        bytes32 tandaKey;
        // slot 2 (packed)
        address opener;
        uint64  openedAt;
        // slot 3 (packed)
        uint64  deadlineTs;
        uint8   disputeId;
        uint8   votesContinue;
        uint8   votesCancel;
        DisputeState state;
        bool    exists;
    }
}
