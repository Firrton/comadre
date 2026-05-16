// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {TestBase} from "./TestBase.t.sol";
import {Comadre} from "../src/Comadre.sol";
import {ComadreErrors as E} from "../src/libraries/ComadreErrors.sol";
import {ComadreTypes as T} from "../src/libraries/ComadreTypes.sol";

contract DisputeTest is TestBase {
    Comadre internal comadre;

    bytes32 internal constant NAME_HASH = keccak256("Tanda Dispute");
    bytes32 internal constant REASON_HASH = keccak256("scam suspected");
    bytes2 internal constant AR = 0x4152;
    uint128 internal constant CONTRIB = 10_000_000;
    uint128 internal constant STAKE = 5_000_000;
    uint32 internal constant FREQ = T.MIN_FREQUENCY;
    uint64 internal constant TANDA_ID = 7;

    function setUp() public override {
        super.setUp();
        vm.prank(admin);
        comadre = new Comadre(usdc, kycOracle, crank, DEFAULT_FEE_BPS, feeDest, defaultKycLimits);

        address[4] memory people = [alice, bob, carol, dave];
        for (uint256 i = 0; i < people.length; i++) {
            comadre.initUserProfile(people[i], keccak256(abi.encodePacked(people[i])), AR);
            vm.prank(kycOracle);
            comadre.updateKycTier(people[i], T.KycTier.T1Lite);
        }
    }

    function _activeTanda() internal returns (bytes32 key) {
        vm.prank(alice);
        key = comadre.createTanda(TANDA_ID, NAME_HASH, 3, CONTRIB, STAKE, FREQ, T.PayoutOrder.JoinOrder);

        address[3] memory joiners = [bob, carol, dave];
        for (uint256 i = 0; i < joiners.length; i++) {
            vm.prank(joiners[i]);
            usdc.approve(address(comadre), STAKE);
            vm.prank(joiners[i]);
            comadre.joinTanda(key, 0);
        }

        vm.prank(alice);
        comadre.startTanda(key);
    }

    // ---------------------------------------------------------------------
    // openDispute
    // ---------------------------------------------------------------------

    function test_openDispute_happyPath() public {
        bytes32 key = _activeTanda();
        bytes32 expectedDispute = comadre.disputeKeyOf(key, 0);

        vm.expectEmit(true, true, true, true);
        emit Comadre.DisputeOpened(expectedDispute, key, bob, uint64(block.timestamp));

        vm.prank(bob);
        bytes32 dispute = comadre.openDispute(key, REASON_HASH);
        assertEq(dispute, expectedDispute);

        T.Dispute memory d = comadre.getDispute(dispute);
        assertTrue(d.exists);
        assertEq(d.reasonHash, REASON_HASH);
        assertEq(d.opener, bob);
        assertEq(d.deadlineTs, uint64(block.timestamp) + T.DISPUTE_VOTING_WINDOW);

        T.Tanda memory t = comadre.getTanda(key);
        assertEq(uint8(t.state), uint8(T.TandaState.Paused));
        assertEq(t.disputesOpened, 1);
    }

    function test_openDispute_revertsWhenNotMember() public {
        bytes32 key = _activeTanda();
        vm.prank(eve);
        vm.expectRevert(E.NotAMember.selector);
        comadre.openDispute(key, REASON_HASH);
    }

    function test_openDispute_revertsWhenTandaNotActive() public {
        bytes32 key = _activeTanda();
        // Open first dispute → tanda Paused.
        vm.prank(bob);
        comadre.openDispute(key, REASON_HASH);

        // Second openDispute call should fail (state != Active).
        vm.prank(carol);
        vm.expectRevert(E.TandaNotActive.selector);
        comadre.openDispute(key, REASON_HASH);
    }

    // ---------------------------------------------------------------------
    // voteDispute
    // ---------------------------------------------------------------------

    function test_voteDispute_continueAndCancelTallies() public {
        bytes32 key = _activeTanda();
        // Audit COM-045: opener cannot vote on their own dispute. Bob opens,
        // carol and dave vote.
        vm.prank(bob);
        bytes32 dispute = comadre.openDispute(key, REASON_HASH);

        vm.prank(carol);
        comadre.voteDispute(key, dispute, true);
        vm.prank(dave);
        comadre.voteDispute(key, dispute, false);

        T.Dispute memory d = comadre.getDispute(dispute);
        assertEq(d.votesContinue, 1);
        assertEq(d.votesCancel, 1);
        assertTrue(comadre.hasVoted(dispute, carol));
        assertTrue(comadre.hasVoted(dispute, dave));
    }

    function test_voteDispute_revertsWhenOpener() public {
        bytes32 key = _activeTanda();
        vm.prank(bob);
        bytes32 dispute = comadre.openDispute(key, REASON_HASH);

        // Audit COM-045: the opener voting on their own dispute reverts.
        vm.prank(bob);
        vm.expectRevert(E.Unauthorized.selector);
        comadre.voteDispute(key, dispute, true);
    }

    function test_voteDispute_revertsOnDoubleVote() public {
        bytes32 key = _activeTanda();
        vm.prank(bob);
        bytes32 dispute = comadre.openDispute(key, REASON_HASH);

        // Bob opens, so carol is the one voting twice.
        vm.prank(carol);
        comadre.voteDispute(key, dispute, true);

        vm.prank(carol);
        vm.expectRevert(E.AlreadyVoted.selector);
        comadre.voteDispute(key, dispute, false);
    }

    function test_voteDispute_revertsAfterDeadline() public {
        bytes32 key = _activeTanda();
        vm.prank(bob);
        bytes32 dispute = comadre.openDispute(key, REASON_HASH);

        _warpForward(T.DISPUTE_VOTING_WINDOW + 1);

        vm.prank(carol);
        vm.expectRevert(E.DisputeExpired.selector);
        comadre.voteDispute(key, dispute, true);
    }

    function test_voteDispute_revertsWhenNotMember() public {
        bytes32 key = _activeTanda();
        vm.prank(bob);
        bytes32 dispute = comadre.openDispute(key, REASON_HASH);

        vm.prank(eve);
        vm.expectRevert(E.NotAMember.selector);
        comadre.voteDispute(key, dispute, true);
    }

    // ---------------------------------------------------------------------
    // resolveDispute
    // ---------------------------------------------------------------------

    function test_resolveDispute_continueWinsRestoresActive() public {
        bytes32 key = _activeTanda();
        // Bob opens, so only carol + dave can vote (audit COM-045).
        vm.prank(bob);
        bytes32 dispute = comadre.openDispute(key, REASON_HASH);

        vm.prank(carol);
        comadre.voteDispute(key, dispute, true);
        vm.prank(dave);
        comadre.voteDispute(key, dispute, true);

        _warpForward(T.DISPUTE_VOTING_WINDOW + 1);

        vm.expectEmit(true, false, false, true);
        emit Comadre.DisputeResolved(dispute, true, uint64(block.timestamp));

        comadre.resolveDispute(key, dispute);

        T.Tanda memory t = comadre.getTanda(key);
        assertEq(uint8(t.state), uint8(T.TandaState.Active));

        T.Dispute memory d = comadre.getDispute(dispute);
        assertEq(uint8(d.state), uint8(T.DisputeState.Resolved));
    }

    function test_resolveDispute_cancelWinsMarksCancelled() public {
        bytes32 key = _activeTanda();
        vm.prank(bob);
        bytes32 dispute = comadre.openDispute(key, REASON_HASH);

        vm.prank(carol);
        comadre.voteDispute(key, dispute, false);
        vm.prank(dave);
        comadre.voteDispute(key, dispute, false);

        _warpForward(T.DISPUTE_VOTING_WINDOW + 1);

        comadre.resolveDispute(key, dispute);

        T.Tanda memory t = comadre.getTanda(key);
        assertEq(uint8(t.state), uint8(T.TandaState.Cancelled));
    }

    function test_resolveDispute_tieDefaultsToCancel() public {
        bytes32 key = _activeTanda();
        vm.prank(bob);
        bytes32 dispute = comadre.openDispute(key, REASON_HASH);

        vm.prank(carol);
        comadre.voteDispute(key, dispute, true);
        vm.prank(dave);
        comadre.voteDispute(key, dispute, false);

        _warpForward(T.DISPUTE_VOTING_WINDOW + 1);

        comadre.resolveDispute(key, dispute);

        T.Tanda memory t = comadre.getTanda(key);
        assertEq(uint8(t.state), uint8(T.TandaState.Cancelled));
    }

    function test_resolveDispute_revertsBeforeDeadline() public {
        bytes32 key = _activeTanda();
        vm.prank(bob);
        bytes32 dispute = comadre.openDispute(key, REASON_HASH);

        vm.expectRevert(E.DisputeNotExpired.selector);
        comadre.resolveDispute(key, dispute);
    }
}
