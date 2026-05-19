// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {TestBase} from "./TestBase.t.sol";
import {Comadre} from "../src/Comadre.sol";
import {ComadreErrors as E} from "../src/libraries/ComadreErrors.sol";
import {ComadreTypes as T} from "../src/libraries/ComadreTypes.sol";

contract SlashTest is TestBase {
    Comadre internal comadre;

    bytes32 internal constant NAME_HASH = keccak256("Tanda Slash");
    bytes2 internal constant AR = 0x4152;
    uint128 internal constant CONTRIB = 10_000_000;
    uint128 internal constant STAKE = 5_000_000;
    uint32 internal constant FREQ = T.MIN_FREQUENCY;
    uint64 internal constant TANDA_ID = 99;

    function setUp() public override {
        super.setUp();
        vm.prank(admin);
        comadre = new Comadre(usdc, kycOracle, crank, DEFAULT_FEE_BPS, feeDest, defaultKycLimits);

        address[3] memory people = [bob, carol, dave];
        for (uint256 i = 0; i < people.length; i++) {
            vm.prank(people[i]);
            comadre.initUserProfile(people[i], keccak256(abi.encodePacked(people[i])), AR);
            vm.prank(kycOracle);
            comadre.updateKycTier(people[i], T.KycTier.T1Lite);
        }
        vm.prank(alice);
        comadre.initUserProfile(alice, keccak256(abi.encodePacked(alice)), AR);
        vm.prank(kycOracle);
        comadre.updateKycTier(alice, T.KycTier.T1Lite);
    }

    function _setupActiveTanda() internal returns (bytes32 key) {
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

    function _contribute(bytes32 key, address user) internal {
        vm.prank(user);
        usdc.approve(address(comadre), CONTRIB);
        vm.prank(user);
        comadre.contribute(key);
    }

    function test_slash_happyPath() public {
        bytes32 key = _setupActiveTanda();
        // bob and carol contribute, dave defaults.
        _contribute(key, bob);
        _contribute(key, carol);

        // Wait until past the payout deadline + grace period.
        _warpForward(FREQ + T.SLASH_GRACE + 1);

        uint256 feeBalBefore = usdc.balanceOf(feeDest);

        vm.expectEmit(true, true, false, true);
        emit Comadre.MemberSlashed(key, dave, STAKE, uint64(block.timestamp));

        vm.prank(crank);
        comadre.slashDefaulter(key, dave);

        assertEq(usdc.balanceOf(feeDest) - feeBalBefore, STAKE);

        T.Member memory m = comadre.getMember(key, dave);
        assertFalse(m.isActive);
        assertEq(m.stakeLocked, 0);

        T.Tanda memory t = comadre.getTanda(key);
        assertEq(t.memberCurrent, 2);
        assertEq(t.vaultBalance, STAKE * 2 + CONTRIB * 2);
    }

    function test_slash_revertsBeforeGraceWindow() public {
        bytes32 key = _setupActiveTanda();
        _contribute(key, bob);
        _contribute(key, carol);

        // After payout deadline but BEFORE grace expires.
        _warpForward(FREQ + 10);

        vm.prank(crank);
        vm.expectRevert(E.MemberNotDefaulted.selector);
        comadre.slashDefaulter(key, dave);
    }

    function test_slash_revertsWhenMemberContributed() public {
        bytes32 key = _setupActiveTanda();
        _contribute(key, bob);
        _contribute(key, carol);
        _contribute(key, dave);

        _warpForward(FREQ + T.SLASH_GRACE + 1);

        vm.prank(crank);
        vm.expectRevert(E.MemberNotDefaulted.selector);
        comadre.slashDefaulter(key, dave);
    }

    function test_slash_revertsWhenNotCrank() public {
        bytes32 key = _setupActiveTanda();
        _warpForward(FREQ + T.SLASH_GRACE + 1);

        vm.prank(alice);
        vm.expectRevert(E.Unauthorized.selector);
        comadre.slashDefaulter(key, dave);
    }

    function test_slash_revertsWhenNotMember() public {
        bytes32 key = _setupActiveTanda();
        _warpForward(FREQ + T.SLASH_GRACE + 1);

        vm.prank(crank);
        vm.expectRevert(E.NotAMember.selector);
        comadre.slashDefaulter(key, eve);
    }

    function test_slash_revertsWhenMemberAlreadyInactive() public {
        bytes32 key = _setupActiveTanda();
        _contribute(key, bob);
        _contribute(key, carol);
        _warpForward(FREQ + T.SLASH_GRACE + 1);

        // First slash succeeds.
        vm.prank(crank);
        comadre.slashDefaulter(key, dave);

        // Second slash on same member reverts.
        vm.prank(crank);
        vm.expectRevert(E.MemberInactive.selector);
        comadre.slashDefaulter(key, dave);
    }
}
