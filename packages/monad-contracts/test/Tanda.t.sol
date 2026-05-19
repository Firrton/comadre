// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {TestBase} from "./TestBase.t.sol";
import {Comadre} from "../src/Comadre.sol";
import {ComadreErrors as E} from "../src/libraries/ComadreErrors.sol";
import {ComadreTypes as T} from "../src/libraries/ComadreTypes.sol";

contract TandaTest is TestBase {
    Comadre internal comadre;

    bytes32 internal constant NAME_HASH = keccak256("Tanda Octubre");
    bytes2 internal constant AR = 0x4152;

    uint128 internal constant CONTRIB = 10_000_000; // 10 USDC
    uint128 internal constant STAKE = 5_000_000; // 5 USDC
    uint32 internal constant FREQ = T.MIN_FREQUENCY; // 24h
    uint64 internal constant TANDA_ID = 1;

    function setUp() public override {
        super.setUp();
        vm.prank(admin);
        comadre = new Comadre(usdc, kycOracle, crank, DEFAULT_FEE_BPS, feeDest, defaultKycLimits);

        address[6] memory people = [alice, bob, carol, dave, eve, frank];
        for (uint256 i = 0; i < people.length; i++) {
            vm.prank(people[i]);
            comadre.initUserProfile(people[i], keccak256(abi.encodePacked(people[i])), AR);
            vm.prank(kycOracle);
            comadre.updateKycTier(people[i], T.KycTier.T1Lite);
        }
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    function _createTanda(address creator_, uint8 memberTarget) internal returns (bytes32 key) {
        vm.prank(creator_);
        key = comadre.createTanda(TANDA_ID, NAME_HASH, memberTarget, CONTRIB, STAKE, FREQ, T.PayoutOrder.JoinOrder);
    }

    function _join(bytes32 key, address user) internal {
        vm.prank(user);
        usdc.approve(address(comadre), STAKE);
        vm.prank(user);
        comadre.joinTanda(key, 0);
    }

    function _contribute(bytes32 key, address user) internal {
        vm.prank(user);
        usdc.approve(address(comadre), CONTRIB);
        vm.prank(user);
        comadre.contribute(key);
    }

    // ---------------------------------------------------------------------
    // createTanda
    // ---------------------------------------------------------------------

    function test_createTanda_happyPath() public {
        bytes32 expectedKey = comadre.tandaKeyOf(alice, TANDA_ID);

        vm.expectEmit(true, true, false, true);
        emit Comadre.TandaCreated(expectedKey, alice, 5, CONTRIB, uint64(block.timestamp));

        bytes32 key = _createTanda(alice, 5);
        assertEq(key, expectedKey);

        T.Tanda memory t = comadre.getTanda(key);
        assertEq(t.creator, alice);
        assertEq(uint8(t.state), uint8(T.TandaState.Forming));
        assertEq(t.memberTarget, 5);
        assertEq(t.totalTurns, 5);
        assertEq(t.memberCurrent, 0);
        assertEq(t.contributionAmount, CONTRIB);
    }

    function test_createTanda_revertsWhenMemberCountTooLow() public {
        vm.prank(alice);
        vm.expectRevert(E.InvalidMemberCount.selector);
        comadre.createTanda(TANDA_ID, NAME_HASH, 2, CONTRIB, STAKE, FREQ, T.PayoutOrder.JoinOrder);
    }

    function test_createTanda_revertsWhenMemberCountTooHigh() public {
        vm.prank(alice);
        vm.expectRevert(E.InvalidMemberCount.selector);
        comadre.createTanda(TANDA_ID, NAME_HASH, T.MAX_MEMBERS + 1, CONTRIB, STAKE, FREQ, T.PayoutOrder.JoinOrder);
    }

    function test_createTanda_revertsWhenContributionZero() public {
        vm.prank(alice);
        vm.expectRevert(E.InvalidStake.selector);
        comadre.createTanda(TANDA_ID, NAME_HASH, 3, 0, STAKE, FREQ, T.PayoutOrder.JoinOrder);
    }

    function test_createTanda_revertsWhenStakeZero() public {
        vm.prank(alice);
        vm.expectRevert(E.InvalidStake.selector);
        comadre.createTanda(TANDA_ID, NAME_HASH, 3, CONTRIB, 0, FREQ, T.PayoutOrder.JoinOrder);
    }

    function test_createTanda_revertsWhenFrequencyTooLow() public {
        vm.prank(alice);
        vm.expectRevert(E.InvalidFrequency.selector);
        comadre.createTanda(TANDA_ID, NAME_HASH, 3, CONTRIB, STAKE, FREQ - 1, T.PayoutOrder.JoinOrder);
    }

    function test_createTanda_revertsWhenKycInsufficient() public {
        // Bring alice back down to T0Demo.
        vm.prank(kycOracle);
        comadre.updateKycTier(alice, T.KycTier.T0Demo);

        vm.prank(alice);
        vm.expectRevert(E.InsufficientKyc.selector);
        comadre.createTanda(TANDA_ID, NAME_HASH, 3, CONTRIB, STAKE, FREQ, T.PayoutOrder.JoinOrder);
    }

    function test_createTanda_revertsWhenProfileMissing() public {
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert(E.ProfileNotFound.selector);
        comadre.createTanda(TANDA_ID, NAME_HASH, 3, CONTRIB, STAKE, FREQ, T.PayoutOrder.JoinOrder);
    }

    function test_createTanda_revertsWhenDuplicate() public {
        _createTanda(alice, 3);
        vm.prank(alice);
        vm.expectRevert(E.AlreadyInitialized.selector);
        comadre.createTanda(TANDA_ID, NAME_HASH, 3, CONTRIB, STAKE, FREQ, T.PayoutOrder.JoinOrder);
    }

    function test_createTanda_revertsWhenPaused() public {
        vm.prank(admin);
        comadre.pause(true);
        vm.prank(alice);
        vm.expectRevert(E.ProgramPaused.selector);
        comadre.createTanda(TANDA_ID, NAME_HASH, 3, CONTRIB, STAKE, FREQ, T.PayoutOrder.JoinOrder);
    }

    // ---------------------------------------------------------------------
    // joinTanda
    // ---------------------------------------------------------------------

    function test_joinTanda_happyPath() public {
        bytes32 key = _createTanda(alice, 3);

        uint256 contractBalBefore = usdc.balanceOf(address(comadre));

        // Approve outside the expectEmit window so the upcoming joinTanda call is
        // the only one whose event log we assert against.
        vm.prank(bob);
        usdc.approve(address(comadre), STAKE);

        vm.expectEmit(true, true, false, true);
        emit Comadre.MemberJoined(key, bob, 1, uint64(block.timestamp));

        vm.prank(bob);
        comadre.joinTanda(key, 0);

        T.Tanda memory t = comadre.getTanda(key);
        assertEq(t.memberCurrent, 1);
        assertEq(t.vaultBalance, STAKE);
        assertEq(comadre.memberByTurn(key, 1), bob);
        assertEq(usdc.balanceOf(address(comadre)) - contractBalBefore, STAKE);

        T.Member memory m = comadre.getMember(key, bob);
        assertTrue(m.exists);
        assertTrue(m.isActive);
        assertEq(m.turnNumber, 1);
        assertEq(m.stakeLocked, STAKE);
    }

    function test_joinTanda_revertsWhenTandaNotFound() public {
        bytes32 phantom = keccak256("nope");
        vm.prank(bob);
        vm.expectRevert(E.TandaNotFound.selector);
        comadre.joinTanda(phantom, 0);
    }

    function test_joinTanda_revertsWhenTandaFull() public {
        bytes32 key = _createTanda(alice, 3);
        _join(key, bob);
        _join(key, carol);
        _join(key, dave);

        vm.prank(eve);
        usdc.approve(address(comadre), STAKE);
        vm.prank(eve);
        vm.expectRevert(E.TandaFull.selector);
        comadre.joinTanda(key, 0);
    }

    function test_joinTanda_revertsWhenKycLimitsInsufficient() public {
        bytes32 key = _createTanda(alice, 3);

        // Lower bob to T0Demo so contribution+stake exceeds the cap.
        vm.prank(kycOracle);
        comadre.updateKycTier(bob, T.KycTier.T0Demo);

        vm.prank(bob);
        usdc.approve(address(comadre), STAKE);
        vm.prank(bob);
        vm.expectRevert(E.KycInsufficientForAmount.selector);
        comadre.joinTanda(key, 0);
    }

    function test_joinTanda_revertsWhenDoubleJoin() public {
        bytes32 key = _createTanda(alice, 3);
        _join(key, bob);

        vm.prank(bob);
        usdc.approve(address(comadre), STAKE);
        vm.prank(bob);
        vm.expectRevert(E.AlreadyInitialized.selector);
        comadre.joinTanda(key, 0);
    }

    // ---------------------------------------------------------------------
    // startTanda
    // ---------------------------------------------------------------------

    function test_startTanda_happyPath() public {
        bytes32 key = _createTanda(alice, 3);
        _join(key, bob);
        _join(key, carol);
        _join(key, dave);

        vm.expectEmit(true, false, false, true);
        emit Comadre.TandaStarted(key, uint64(block.timestamp));

        vm.prank(alice);
        comadre.startTanda(key);

        T.Tanda memory t = comadre.getTanda(key);
        assertEq(uint8(t.state), uint8(T.TandaState.Active));
        assertEq(t.currentTurn, 1);
        assertEq(t.nextPayoutTs, uint64(block.timestamp) + FREQ);
    }

    function test_startTanda_revertsWhenNotCreator() public {
        bytes32 key = _createTanda(alice, 3);
        _join(key, bob);
        _join(key, carol);
        _join(key, dave);

        vm.prank(bob);
        vm.expectRevert(E.NotCreator.selector);
        comadre.startTanda(key);
    }

    function test_startTanda_revertsWhenNotFull() public {
        bytes32 key = _createTanda(alice, 3);
        _join(key, bob);

        vm.prank(alice);
        vm.expectRevert(E.InvalidMemberCount.selector);
        comadre.startTanda(key);
    }

    // ---------------------------------------------------------------------
    // contribute
    // ---------------------------------------------------------------------

    function test_contribute_happyPath() public {
        bytes32 key = _startFullTanda();

        uint256 balBefore = usdc.balanceOf(address(comadre));

        vm.prank(bob);
        usdc.approve(address(comadre), CONTRIB);

        vm.expectEmit(true, true, false, true);
        emit Comadre.ContributionMade(key, bob, 1, CONTRIB, uint64(block.timestamp));

        vm.prank(bob);
        comadre.contribute(key);

        T.Member memory m = comadre.getMember(key, bob);
        assertEq(m.contributionsMade, 1);

        T.Tanda memory t = comadre.getTanda(key);
        assertEq(t.contributionsThisTurn, 1);
        assertEq(t.vaultBalance, STAKE * 3 + CONTRIB);
        assertEq(usdc.balanceOf(address(comadre)) - balBefore, CONTRIB);
    }

    function test_contribute_revertsWhenNotActive() public {
        bytes32 key = _createTanda(alice, 3);
        _join(key, bob);

        vm.prank(bob);
        usdc.approve(address(comadre), CONTRIB);
        vm.prank(bob);
        vm.expectRevert(E.TandaNotActive.selector);
        comadre.contribute(key);
    }

    function test_contribute_revertsWhenNotMember() public {
        bytes32 key = _startFullTanda();

        // eve is registered but never joined this tanda.
        vm.prank(eve);
        usdc.approve(address(comadre), CONTRIB);
        vm.prank(eve);
        vm.expectRevert(E.NotAMember.selector);
        comadre.contribute(key);
    }

    function test_contribute_revertsWhenAlreadyContributed() public {
        bytes32 key = _startFullTanda();
        _contribute(key, bob);

        vm.prank(bob);
        usdc.approve(address(comadre), CONTRIB);
        vm.prank(bob);
        vm.expectRevert(E.AlreadyContributed.selector);
        comadre.contribute(key);
    }

    // ---------------------------------------------------------------------
    // payout (single turn) + completeTanda implicit-on-last-turn
    // ---------------------------------------------------------------------

    function test_payout_happyPath() public {
        bytes32 key = _startFullTanda();
        _contributeAll(key);

        _warpForward(FREQ);

        uint256 gross = uint256(CONTRIB) * 3;
        uint256 expectedFee = (gross * DEFAULT_FEE_BPS) / 10_000;
        uint256 expectedNet = gross - expectedFee;
        uint256 bobBalBefore = usdc.balanceOf(bob);
        uint256 feeDestBefore = usdc.balanceOf(feeDest);

        vm.expectEmit(true, true, false, true);
        emit Comadre.PayoutExecuted(key, bob, 1, uint128(expectedNet), uint64(block.timestamp));

        vm.prank(crank);
        comadre.payout(key);

        assertEq(usdc.balanceOf(bob) - bobBalBefore, expectedNet);
        assertEq(usdc.balanceOf(feeDest) - feeDestBefore, expectedFee);

        T.Member memory m = comadre.getMember(key, bob);
        assertTrue(m.hasReceivedPayout);

        T.Tanda memory t = comadre.getTanda(key);
        assertEq(t.currentTurn, 2);
        assertEq(t.contributionsThisTurn, 0);
        assertEq(t.nextPayoutTs, uint64(block.timestamp) + FREQ);
    }

    function test_payout_revertsWhenNotCrank() public {
        bytes32 key = _startFullTanda();
        _contributeAll(key);
        _warpForward(FREQ);

        vm.prank(alice);
        vm.expectRevert(E.Unauthorized.selector);
        comadre.payout(key);
    }

    function test_payout_revertsWhenNotReady() public {
        bytes32 key = _startFullTanda();
        _contributeAll(key);

        vm.prank(crank);
        vm.expectRevert(E.PayoutNotReady.selector);
        comadre.payout(key);
    }

    function test_payout_revertsWhenMissingContributions() public {
        bytes32 key = _startFullTanda();
        _contribute(key, bob);
        _contribute(key, carol);
        // dave missing
        _warpForward(FREQ);

        vm.prank(crank);
        vm.expectRevert(E.MissingContributions.selector);
        comadre.payout(key);
    }

    // ---------------------------------------------------------------------
    // E2E: 3-member, 3-turn full cycle
    // ---------------------------------------------------------------------

    function test_e2e_fullCycle_marksCompleted() public {
        bytes32 key = _startFullTanda();

        for (uint8 turn = 1; turn <= 3; turn++) {
            _contributeAll(key);
            _warpForward(FREQ);
            vm.prank(crank);
            comadre.payout(key);
        }

        T.Tanda memory t = comadre.getTanda(key);
        assertEq(uint8(t.state), uint8(T.TandaState.Completed));
        assertEq(t.currentTurn, 3);
    }

    // ---------------------------------------------------------------------
    // Internal: start a 3-member tanda with bob, carol, dave joined.
    // currentTurn=1 = bob (joined first).
    // ---------------------------------------------------------------------

    function _startFullTanda() internal returns (bytes32 key) {
        key = _createTanda(alice, 3);
        _join(key, bob);
        _join(key, carol);
        _join(key, dave);
        vm.prank(alice);
        comadre.startTanda(key);
    }

    function _contributeAll(bytes32 key) internal {
        _contribute(key, bob);
        _contribute(key, carol);
        _contribute(key, dave);
    }
}
