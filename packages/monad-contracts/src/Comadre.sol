// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {ComadreTypes as T} from "./libraries/ComadreTypes.sol";
import {ComadreErrors as E} from "./libraries/ComadreErrors.sol";

/**
 * @title Comadre
 * @notice On-chain enforcement engine for Comadre's rotating savings groups (tandas).
 *         The contract holds USDC on behalf of every active tanda and tracks
 *         per-tanda balances; it never co-mingles funds across tandas in any
 *         destructive way thanks to `Tanda.vaultBalance` accounting.
 *
 *         Migration note: this contract is the Solidity port of the original
 *         Anchor program `comadre` on Solana. See `docs/WALLET_SECURITY.md` and
 *         the change in `openspec/` for behavioral parity references.
 *
 *         Skeleton scope (this file): storage, access modifiers, constructor,
 *         key-derivation helpers. Business-logic instructions (createTanda,
 *         joinTanda, payout, …) are added incrementally in follow-up changes.
 */
contract Comadre is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // -------------------------------------------------------------------------
    // Immutable / constructor-set state
    // -------------------------------------------------------------------------

    IERC20 public immutable usdc;

    /// @notice Account allowed to flip pause, rotate roles, and tune fees.
    address public admin;
    /// @notice Account allowed to call `updateKycTier`.
    address public kycOracle;
    /// @notice Account allowed to call `payout`, `slashDefaulter`, `completeTanda`.
    address public crankAuthority;
    /// @notice Account that receives the protocol fee on each payout and slashed stakes.
    address public feeDestination;

    /// @notice Protocol fee in basis points, applied at payout. Bounded by `MAX_FEE_BPS`.
    uint16 public feeBps;
    /// @notice Global pause switch.
    bool public paused;

    /// @notice Per-tier maximum (contribution + stake) in micro-USDC. Indexed by `KycTier`.
    uint64[4] public kycLimits;

    // -------------------------------------------------------------------------
    // Per-actor / per-entity storage
    // -------------------------------------------------------------------------

    mapping(address => T.UserProfile) internal _userProfiles;
    mapping(bytes32 => T.Tanda) internal _tandas;
    mapping(bytes32 => T.Member) internal _members;
    /// @dev Convenience index used by payout/slash: tandaKey → turn → member.user.
    mapping(bytes32 => mapping(uint8 => address)) public memberByTurn;

    mapping(bytes32 => T.Dispute) internal _disputes;
    /// @dev Replaces Anchor's `DisputeVote` PDA. One vote per (dispute, voter).
    mapping(bytes32 => mapping(address => bool)) public hasVoted;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event ConfigInitialized(
        address admin,
        address kycOracle,
        address crankAuthority,
        address feeDestination,
        uint16 feeBps
    );
    event ProgramPausedSet(bool paused);
    event AdminChanged(address indexed previous, address indexed current);
    event KycOracleChanged(address indexed previous, address indexed current);
    event CrankAuthorityChanged(address indexed previous, address indexed current);
    event FeeDestinationChanged(address indexed previous, address indexed current);
    event FeeBpsChanged(uint16 previous, uint16 current);

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------

    modifier onlyAdmin() {
        if (msg.sender != admin) revert E.Unauthorized();
        _;
    }

    modifier onlyKycOracle() {
        if (msg.sender != kycOracle) revert E.Unauthorized();
        _;
    }

    modifier onlyCrank() {
        if (msg.sender != crankAuthority) revert E.Unauthorized();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert E.ProgramPaused();
        _;
    }

    // -------------------------------------------------------------------------
    // Constructor — merges Anchor's `init_config` to eliminate front-run window
    // -------------------------------------------------------------------------

    /**
     * @param _usdc            ERC-20 USDC token address (6 decimals expected).
     * @param _kycOracle       Address authorised to upgrade KYC tiers.
     * @param _crankAuthority  Address authorised to run payouts / slashes.
     * @param _feeBps          Protocol fee in bps (max 10_000).
     * @param _feeDestination  Address that receives fees and slashed stakes.
     * @param _kycLimits       Per-tier maximum (contribution + stake) in micro-USDC,
     *                         monotonically non-decreasing, [0] > 0 required.
     */
    constructor(
        IERC20 _usdc,
        address _kycOracle,
        address _crankAuthority,
        uint16 _feeBps,
        address _feeDestination,
        uint64[4] memory _kycLimits
    ) {
        if (_feeBps > T.MAX_FEE_BPS) revert E.InvalidFeeBps();
        if (_kycLimits[0] == 0) revert E.InvalidKycLimits();
        for (uint256 i = 1; i < T.KYC_TIER_COUNT; i++) {
            if (_kycLimits[i] < _kycLimits[i - 1]) revert E.InvalidKycLimits();
        }

        usdc = _usdc;
        admin = msg.sender;
        kycOracle = _kycOracle;
        crankAuthority = _crankAuthority;
        feeBps = _feeBps;
        feeDestination = _feeDestination;
        kycLimits = _kycLimits;

        emit ConfigInitialized(msg.sender, _kycOracle, _crankAuthority, _feeDestination, _feeBps);
    }

    // -------------------------------------------------------------------------
    // Admin: pause + role rotations
    // (One-line each — full Admin.t.sol covers their bounds.)
    // -------------------------------------------------------------------------

    function pause(bool _paused) external onlyAdmin {
        paused = _paused;
        emit ProgramPausedSet(_paused);
    }

    function setAdmin(address newAdmin) external onlyAdmin {
        emit AdminChanged(admin, newAdmin);
        admin = newAdmin;
    }

    function setKycOracle(address newOracle) external onlyAdmin {
        emit KycOracleChanged(kycOracle, newOracle);
        kycOracle = newOracle;
    }

    function setCrankAuthority(address newCrank) external onlyAdmin {
        emit CrankAuthorityChanged(crankAuthority, newCrank);
        crankAuthority = newCrank;
    }

    function setFeeDestination(address newDest) external onlyAdmin {
        emit FeeDestinationChanged(feeDestination, newDest);
        feeDestination = newDest;
    }

    function setFeeBps(uint16 newBps) external onlyAdmin {
        if (newBps > T.MAX_FEE_BPS) revert E.InvalidFeeBps();
        emit FeeBpsChanged(feeBps, newBps);
        feeBps = newBps;
    }

    // -------------------------------------------------------------------------
    // User profile + KYC
    // -------------------------------------------------------------------------

    event UserProfileInitialized(address indexed wallet, bytes32 phoneHash, bytes2 countryCode, uint64 timestamp);
    event KycTierUpdated(address indexed wallet, uint8 newTier, uint64 timestamp);

    /**
     * @notice Create a profile for `wallet`. Anyone can pay to initialise a
     *         profile for another address (matches Anchor `init_user_profile`),
     *         but only the KYC oracle may later upgrade the tier.
     */
    function initUserProfile(
        address wallet,
        bytes32 phoneHash,
        bytes2 countryCode
    ) external whenNotPaused {
        T.UserProfile storage profile = _userProfiles[wallet];
        if (profile.exists) revert E.AlreadyInitialized();

        profile.phoneHash = phoneHash;
        profile.countryCode = countryCode;
        profile.kycTier = uint8(T.KycTier.T0Demo);
        profile.exists = true;
        profile.createdAt = uint64(block.timestamp);

        emit UserProfileInitialized(wallet, phoneHash, countryCode, uint64(block.timestamp));
    }

    /**
     * @notice Upgrade or downgrade a user's KYC tier. Callable only by the
     *         configured oracle, blocked when paused.
     */
    function updateKycTier(address wallet, T.KycTier newTier) external onlyKycOracle whenNotPaused {
        T.UserProfile storage profile = _userProfiles[wallet];
        if (!profile.exists) revert E.ProfileNotFound();
        profile.kycTier = uint8(newTier);

        emit KycTierUpdated(wallet, uint8(newTier), uint64(block.timestamp));
    }

    // -------------------------------------------------------------------------
    // Tanda lifecycle
    // -------------------------------------------------------------------------

    event TandaCreated(
        bytes32 indexed tandaKey,
        address indexed creator,
        uint8 memberTarget,
        uint128 contributionAmount,
        uint64 timestamp
    );
    event MemberJoined(bytes32 indexed tandaKey, address indexed user, uint8 turnNumber, uint64 timestamp);
    event TandaStarted(bytes32 indexed tandaKey, uint64 timestamp);
    event ContributionMade(
        bytes32 indexed tandaKey,
        address indexed user,
        uint8 turn,
        uint128 amount,
        uint64 timestamp
    );
    event PayoutExecuted(
        bytes32 indexed tandaKey,
        address indexed beneficiary,
        uint8 turn,
        uint128 amount,
        uint64 timestamp
    );
    event TandaCompleted(bytes32 indexed tandaKey, uint64 timestamp);

    /**
     * @notice Creates a tanda. The caller must already have a user profile and
     *         be T1Lite or above. The Anchor `name_hash` semantics are preserved:
     *         the on-chain contract stores the hash, the friendly name lives off-chain.
     */
    function createTanda(
        uint64 tandaId,
        bytes32 nameHash,
        uint8 memberTarget,
        uint128 contributionAmount,
        uint128 stakeAmount,
        uint32 frequencySeconds,
        T.PayoutOrder payoutOrderMode
    ) external whenNotPaused returns (bytes32 tandaKey) {
        T.UserProfile storage profile = _userProfiles[msg.sender];
        if (!profile.exists) revert E.ProfileNotFound();
        if (profile.kycTier < uint8(T.KycTier.T1Lite)) revert E.InsufficientKyc();

        if (memberTarget < T.MIN_MEMBERS || memberTarget > T.MAX_MEMBERS) revert E.InvalidMemberCount();
        if (contributionAmount == 0 || stakeAmount == 0) revert E.InvalidStake();
        if (frequencySeconds < T.MIN_FREQUENCY) revert E.InvalidFrequency();

        tandaKey = tandaKeyOf(msg.sender, tandaId);
        T.Tanda storage tanda = _tandas[tandaKey];
        if (tanda.exists) revert E.AlreadyInitialized();

        tanda.creator = msg.sender;
        tanda.tandaId = tandaId;
        tanda.nameHash = nameHash;
        tanda.memberTarget = memberTarget;
        tanda.totalTurns = memberTarget;
        tanda.contributionAmount = contributionAmount;
        tanda.stakeAmount = stakeAmount;
        tanda.frequencySeconds = frequencySeconds;
        tanda.state = T.TandaState.Forming;
        tanda.payoutOrderMode = payoutOrderMode;
        tanda.createdAt = uint64(block.timestamp);
        tanda.exists = true;

        unchecked {
            profile.tandasCreated += 1;
        }

        emit TandaCreated(tandaKey, msg.sender, memberTarget, contributionAmount, uint64(block.timestamp));
    }

    /**
     * @notice Join an existing tanda. Transfers `stakeAmount` USDC from the
     *         caller into the contract's per-tanda vault. The caller must
     *         have a profile and enough KYC tier headroom for `contribution+stake`.
     *
     *         For v1 only `PayoutOrder.JoinOrder` is supported; the supplied
     *         `turnNumber` is ignored and the next sequential turn is assigned.
     */
    function joinTanda(bytes32 tandaKey, uint8 /* turnNumber */) external whenNotPaused nonReentrant {
        T.Tanda storage tanda = _tandas[tandaKey];
        if (!tanda.exists) revert E.TandaNotFound();
        if (tanda.state != T.TandaState.Forming) revert E.TandaNotForming();
        if (tanda.memberCurrent >= tanda.memberTarget) revert E.TandaFull();
        if (tanda.payoutOrderMode != T.PayoutOrder.JoinOrder) revert E.NotImplemented();

        T.UserProfile storage profile = _userProfiles[msg.sender];
        if (!profile.exists) revert E.ProfileNotFound();

        uint256 required = uint256(tanda.contributionAmount) + uint256(tanda.stakeAmount);
        if (uint256(kycLimits[profile.kycTier]) < required) revert E.KycInsufficientForAmount();

        bytes32 mKey = memberKeyOf(tandaKey, msg.sender);
        T.Member storage member = _members[mKey];
        if (member.exists) revert E.AlreadyInitialized();

        unchecked {
            tanda.memberCurrent += 1;
        }
        uint8 assignedTurn = tanda.memberCurrent;

        member.user = msg.sender;
        member.turnNumber = assignedTurn;
        member.stakeLocked = tanda.stakeAmount;
        member.isActive = true;
        member.joinedAt = uint64(block.timestamp);
        member.exists = true;

        memberByTurn[tandaKey][assignedTurn] = msg.sender;
        tanda.vaultBalance += tanda.stakeAmount;

        usdc.safeTransferFrom(msg.sender, address(this), tanda.stakeAmount);

        emit MemberJoined(tandaKey, msg.sender, assignedTurn, uint64(block.timestamp));
    }

    /// @notice Transition a full tanda from Forming to Active. Only the creator
    ///         may call; all member slots must be taken; v1 requires JoinOrder.
    function startTanda(bytes32 tandaKey) external whenNotPaused {
        T.Tanda storage tanda = _tandas[tandaKey];
        if (!tanda.exists) revert E.TandaNotFound();
        if (msg.sender != tanda.creator) revert E.NotCreator();
        if (tanda.state != T.TandaState.Forming) revert E.TandaNotForming();
        if (tanda.memberCurrent != tanda.memberTarget) revert E.InvalidMemberCount();
        if (tanda.payoutOrderMode != T.PayoutOrder.JoinOrder) revert E.NotImplemented();

        tanda.state = T.TandaState.Active;
        tanda.currentTurn = 1;
        tanda.startedAt = uint64(block.timestamp);
        tanda.nextPayoutTs = uint64(block.timestamp) + tanda.frequencySeconds;

        emit TandaStarted(tandaKey, uint64(block.timestamp));
    }

    /// @notice Contribute the per-round amount. Member must be active and not
    ///         already contributed in the current turn.
    function contribute(bytes32 tandaKey) external whenNotPaused nonReentrant {
        T.Tanda storage tanda = _tandas[tandaKey];
        if (!tanda.exists) revert E.TandaNotFound();
        if (tanda.state != T.TandaState.Active) revert E.TandaNotActive();

        T.Member storage member = _members[memberKeyOf(tandaKey, msg.sender)];
        if (!member.exists) revert E.NotAMember();
        if (!member.isActive) revert E.MemberInactive();
        if (member.contributionsMade >= tanda.currentTurn) revert E.AlreadyContributed();

        unchecked {
            member.contributionsMade += 1;
            tanda.contributionsThisTurn += 1;
        }
        member.lastContributionTs = uint64(block.timestamp);
        tanda.vaultBalance += tanda.contributionAmount;

        usdc.safeTransferFrom(msg.sender, address(this), tanda.contributionAmount);

        emit ContributionMade(
            tandaKey, msg.sender, tanda.currentTurn, tanda.contributionAmount, uint64(block.timestamp)
        );
    }

    /**
     * @notice Pay out the current-turn pot to the scheduled beneficiary.
     *         Requires: crank caller, tanda active, all members contributed,
     *                   payout deadline reached.
     *         Applies the protocol fee in basis points before transferring.
     *         Advances the turn or marks the tanda Completed when the last
     *         turn is paid out.
     */
    function payout(bytes32 tandaKey) external onlyCrank whenNotPaused nonReentrant {
        T.Tanda storage tanda = _tandas[tandaKey];
        if (!tanda.exists) revert E.TandaNotFound();
        if (tanda.state != T.TandaState.Active) revert E.TandaNotActive();
        if (block.timestamp < tanda.nextPayoutTs) revert E.PayoutNotReady();
        if (tanda.contributionsThisTurn != tanda.memberTarget) revert E.MissingContributions();

        address beneficiary = memberByTurn[tandaKey][tanda.currentTurn];
        T.Member storage beneficiaryMember = _members[memberKeyOf(tandaKey, beneficiary)];
        if (beneficiaryMember.hasReceivedPayout) revert E.AlreadyPaidOut();
        // Audit COM-003: do not pay out to a slashed (inactive) member. If the
        // current-turn beneficiary was slashed, the crank caller must reroute.
        if (!beneficiaryMember.isActive) revert E.MemberInactive();

        uint256 gross = uint256(tanda.contributionAmount) * uint256(tanda.memberTarget);
        uint256 fee = (gross * feeBps) / T.BPS_DENOMINATOR;
        uint256 net = gross - fee;

        beneficiaryMember.hasReceivedPayout = true;
        tanda.vaultBalance -= uint128(gross);
        tanda.contributionsThisTurn = 0;

        if (fee > 0) usdc.safeTransfer(feeDestination, fee);
        usdc.safeTransfer(beneficiary, net);

        emit PayoutExecuted(tandaKey, beneficiary, tanda.currentTurn, uint128(net), uint64(block.timestamp));

        if (tanda.currentTurn == tanda.totalTurns) {
            tanda.state = T.TandaState.Completed;
            emit TandaCompleted(tandaKey, uint64(block.timestamp));
        } else {
            unchecked {
                tanda.currentTurn += 1;
            }
            tanda.nextPayoutTs = uint64(block.timestamp) + tanda.frequencySeconds;
        }
    }

    /**
     * @notice Idempotent completion marker. Useful when a tanda finishes via
     *         a different path (e.g. dispute-cancelled at the last turn).
     *         No-op if already Completed.
     */
    function completeTanda(bytes32 tandaKey) external onlyCrank whenNotPaused {
        T.Tanda storage tanda = _tandas[tandaKey];
        if (!tanda.exists) revert E.TandaNotFound();
        if (tanda.state == T.TandaState.Completed) return;
        if (tanda.state != T.TandaState.Active) revert E.TandaNotActive();
        if (tanda.currentTurn <= tanda.totalTurns) revert E.InvalidMemberCount();

        tanda.state = T.TandaState.Completed;
        emit TandaCompleted(tandaKey, uint64(block.timestamp));
    }

    // -------------------------------------------------------------------------
    // Slash
    // -------------------------------------------------------------------------

    event MemberSlashed(bytes32 indexed tandaKey, address indexed member, uint128 stakeLost, uint64 timestamp);

    /**
     * @notice Slash a defaulting member's stake into the fee destination.
     *         A member is considered defaulted when, by the time the
     *         `nextPayoutTs + SLASH_GRACE` window has passed, they still
     *         have not contributed in the current turn.
     *
     *         The member's stake is transferred to `feeDestination` and the
     *         member is marked inactive; `memberCurrent` is decremented so the
     *         tanda can complete naturally without them.
     */
    function slashDefaulter(bytes32 tandaKey, address defaulter)
        external
        onlyCrank
        whenNotPaused
        nonReentrant
    {
        T.Tanda storage tanda = _tandas[tandaKey];
        if (!tanda.exists) revert E.TandaNotFound();
        if (tanda.state != T.TandaState.Active) revert E.TandaNotActive();

        T.Member storage member = _members[memberKeyOf(tandaKey, defaulter)];
        if (!member.exists) revert E.NotAMember();
        if (!member.isActive) revert E.MemberInactive();

        // Default condition: hasn't contributed this turn AND the grace window past the
        // expected payout has elapsed. `block.timestamp > nextPayoutTs + SLASH_GRACE`.
        bool missedThisTurn = member.contributionsMade < tanda.currentTurn;
        bool gracePassed = block.timestamp > uint256(tanda.nextPayoutTs) + T.SLASH_GRACE;
        if (!missedThisTurn || !gracePassed) revert E.MemberNotDefaulted();

        uint128 stake = member.stakeLocked;
        member.stakeLocked = 0;
        member.isActive = false;
        tanda.vaultBalance -= stake;

        unchecked {
            tanda.memberCurrent -= 1;
        }

        usdc.safeTransfer(feeDestination, stake);

        emit MemberSlashed(tandaKey, defaulter, stake, uint64(block.timestamp));
    }

    // -------------------------------------------------------------------------
    // Disputes
    // -------------------------------------------------------------------------

    event DisputeOpened(
        bytes32 indexed disputeKey,
        bytes32 indexed tandaKey,
        address indexed opener,
        uint64 timestamp
    );
    event DisputeVoted(bytes32 indexed disputeKey, address indexed voter, bool continueTanda, uint64 timestamp);
    event DisputeResolved(bytes32 indexed disputeKey, bool continueTanda, uint64 timestamp);

    /**
     * @notice Open a dispute against the tanda. Pauses the tanda for the
     *         duration of the voting window. Up to `MAX_DISPUTES_PER_TANDA`
     *         per tanda.
     */
    function openDispute(bytes32 tandaKey, bytes32 reasonHash)
        external
        whenNotPaused
        returns (bytes32 disputeKey)
    {
        T.Tanda storage tanda = _tandas[tandaKey];
        if (!tanda.exists) revert E.TandaNotFound();
        if (tanda.state != T.TandaState.Active) revert E.TandaNotActive();
        if (tanda.disputesOpened >= T.MAX_DISPUTES_PER_TANDA) revert E.MaxDisputesReached();

        T.Member storage member = _members[memberKeyOf(tandaKey, msg.sender)];
        if (!member.exists || !member.isActive) revert E.NotAMember();

        uint8 disputeId = tanda.disputesOpened;
        disputeKey = disputeKeyOf(tandaKey, disputeId);

        T.Dispute storage dispute = _disputes[disputeKey];
        dispute.reasonHash = reasonHash;
        dispute.opener = msg.sender;
        dispute.openedAt = uint64(block.timestamp);
        dispute.deadlineTs = uint64(block.timestamp) + T.DISPUTE_VOTING_WINDOW;
        dispute.disputeId = disputeId;
        dispute.state = T.DisputeState.Open;
        dispute.exists = true;

        unchecked {
            tanda.disputesOpened += 1;
        }
        tanda.state = T.TandaState.Paused;

        emit DisputeOpened(disputeKey, tandaKey, msg.sender, uint64(block.timestamp));
    }

    /**
     * @notice Cast a vote on an open dispute. Each active member of the tanda
     *         may vote once. Voting window is `DISPUTE_VOTING_WINDOW` after open.
     *
     *         The `tandaKey` argument is required because the dispute key on its
     *         own would not let us resolve the member without a reverse index.
     *         Pass the same `tandaKey` that was used to derive `disputeKey`.
     */
    function voteDispute(bytes32 tandaKey, bytes32 disputeKey, bool continueTanda) external whenNotPaused {
        T.Dispute storage dispute = _disputes[disputeKey];
        if (!dispute.exists) revert E.DisputeNotFound();
        if (dispute.state != T.DisputeState.Open) revert E.DisputeNotOpen();
        if (block.timestamp > dispute.deadlineTs) revert E.DisputeExpired();
        // Audit COM-045: the opener should not be able to vote on their own dispute.
        if (msg.sender == dispute.opener) revert E.Unauthorized();

        T.Member storage member = _members[memberKeyOf(tandaKey, msg.sender)];
        if (!member.exists || !member.isActive) revert E.NotAMember();

        if (hasVoted[disputeKey][msg.sender]) revert E.AlreadyVoted();
        hasVoted[disputeKey][msg.sender] = true;

        unchecked {
            if (continueTanda) dispute.votesContinue += 1;
            else dispute.votesCancel += 1;
        }

        emit DisputeVoted(disputeKey, msg.sender, continueTanda, uint64(block.timestamp));
    }

    /**
     * @notice Resolve a dispute after the voting window closes. Ties resolve to
     *         "cancel" as a safety default (the chain favors leaving the funds
     *         claimable rather than continuing under contention).
     *
     *         Anyone may call once the deadline has passed — the outcome is
     *         determined purely by the recorded votes.
     */
    function resolveDispute(bytes32 tandaKey, bytes32 disputeKey) external whenNotPaused {
        T.Dispute storage dispute = _disputes[disputeKey];
        if (!dispute.exists) revert E.DisputeNotFound();
        if (dispute.state != T.DisputeState.Open) revert E.DisputeNotOpen();
        if (block.timestamp <= dispute.deadlineTs) revert E.DisputeNotExpired();

        T.Tanda storage tanda = _tandas[tandaKey];
        if (!tanda.exists) revert E.TandaNotFound();

        bool continueTanda = dispute.votesContinue > dispute.votesCancel;
        dispute.state = T.DisputeState.Resolved;

        tanda.state = continueTanda ? T.TandaState.Active : T.TandaState.Cancelled;

        emit DisputeResolved(disputeKey, continueTanda, uint64(block.timestamp));
    }

    // -------------------------------------------------------------------------
    // claimStake — closes Anchor's known TODO around stake refunds.
    // -------------------------------------------------------------------------

    event StakeClaimed(bytes32 indexed tandaKey, address indexed member, uint128 amount, uint64 timestamp);

    /**
     * @notice Pull-pattern recovery of a member's locked stake once the tanda
     *         finishes (`Completed`) or is cancelled by dispute (`Cancelled`).
     *         Slashed members (`isActive == false`, `stakeLocked == 0`) get nothing.
     *
     *         Pull rather than push so completing the tanda stays a constant-gas
     *         operation; members claim individually on their own schedule.
     */
    function claimStake(bytes32 tandaKey) external whenNotPaused nonReentrant {
        T.Tanda storage tanda = _tandas[tandaKey];
        if (!tanda.exists) revert E.TandaNotFound();
        if (tanda.state != T.TandaState.Completed && tanda.state != T.TandaState.Cancelled) {
            revert E.TandaNotActive(); // semantically: "tanda must be in a terminal state"
        }

        T.Member storage member = _members[memberKeyOf(tandaKey, msg.sender)];
        if (!member.exists) revert E.NotAMember();
        if (!member.isActive) revert E.MemberInactive();
        if (member.stakeLocked == 0) revert E.InvalidStake();

        uint128 amount = member.stakeLocked;
        member.stakeLocked = 0;
        tanda.vaultBalance -= amount;

        usdc.safeTransfer(msg.sender, amount);

        emit StakeClaimed(tandaKey, msg.sender, amount, uint64(block.timestamp));
    }

    // -------------------------------------------------------------------------
    // Pure key-derivation helpers
    // Solidity replacement for Solana PDAs. Stable across runs and verifiable
    // off-chain by clients via the same keccak256(abi.encode(...)).
    // -------------------------------------------------------------------------

    function tandaKeyOf(address creator, uint64 tandaId) public pure returns (bytes32) {
        return keccak256(abi.encode(creator, tandaId));
    }

    function memberKeyOf(bytes32 tandaKey, address user) public pure returns (bytes32) {
        return keccak256(abi.encode(tandaKey, user));
    }

    function disputeKeyOf(bytes32 tandaKey, uint8 disputeId) public pure returns (bytes32) {
        return keccak256(abi.encode(tandaKey, disputeId));
    }

    // -------------------------------------------------------------------------
    // External views — public read helpers for clients / indexer
    // -------------------------------------------------------------------------

    function getUserProfile(address wallet) external view returns (T.UserProfile memory) {
        return _userProfiles[wallet];
    }

    function getTanda(bytes32 key) external view returns (T.Tanda memory) {
        return _tandas[key];
    }

    function getMember(bytes32 tandaKey, address user) external view returns (T.Member memory) {
        return _members[memberKeyOf(tandaKey, user)];
    }

    function getDispute(bytes32 key) external view returns (T.Dispute memory) {
        return _disputes[key];
    }

    function getKycLimits() external view returns (uint64[4] memory) {
        return kycLimits;
    }
}
