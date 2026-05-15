// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {TestBase} from "./TestBase.t.sol";
import {Comadre} from "../src/Comadre.sol";
import {ComadreErrors as E} from "../src/libraries/ComadreErrors.sol";
import {ComadreTypes as T} from "../src/libraries/ComadreTypes.sol";

contract ClaimStakeTest is TestBase {
    Comadre internal comadre;

    bytes32 internal constant NAME_HASH = keccak256("Tanda Claim");
    bytes2 internal constant AR = 0x4152;
    uint128 internal constant CONTRIB = 10_000_000;
    uint128 internal constant STAKE = 5_000_000;
    uint32 internal constant FREQ = T.MIN_FREQUENCY;
    uint64 internal constant TANDA_ID = 42;

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

    function _runFullCycle() internal returns (bytes32 key) {
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

        for (uint8 turn = 0; turn < 3; turn++) {
            for (uint256 i = 0; i < joiners.length; i++) {
                vm.prank(joiners[i]);
                usdc.approve(address(comadre), CONTRIB);
                vm.prank(joiners[i]);
                comadre.contribute(key);
            }
            _warpForward(FREQ);
            vm.prank(crank);
            comadre.payout(key);
        }
    }

    function test_claimStake_happyPathAfterCompletion() public {
        bytes32 key = _runFullCycle();

        uint256 bobBalBefore = usdc.balanceOf(bob);

        vm.expectEmit(true, true, false, true);
        emit Comadre.StakeClaimed(key, bob, STAKE, uint64(block.timestamp));

        vm.prank(bob);
        comadre.claimStake(key);

        assertEq(usdc.balanceOf(bob) - bobBalBefore, STAKE);

        T.Member memory m = comadre.getMember(key, bob);
        assertEq(m.stakeLocked, 0);
    }

    function test_claimStake_revertsWhenTandaStillActive() public {
        vm.prank(alice);
        bytes32 key = comadre.createTanda(TANDA_ID, NAME_HASH, 3, CONTRIB, STAKE, FREQ, T.PayoutOrder.JoinOrder);

        vm.prank(bob);
        usdc.approve(address(comadre), STAKE);
        vm.prank(bob);
        comadre.joinTanda(key, 0);

        vm.prank(bob);
        vm.expectRevert(E.TandaNotActive.selector);
        comadre.claimStake(key);
    }

    function test_claimStake_revertsOnDoubleClaim() public {
        bytes32 key = _runFullCycle();

        vm.prank(bob);
        comadre.claimStake(key);

        vm.prank(bob);
        vm.expectRevert(E.InvalidStake.selector);
        comadre.claimStake(key);
    }

    function test_claimStake_revertsWhenNotMember() public {
        bytes32 key = _runFullCycle();

        vm.prank(eve);
        vm.expectRevert(E.NotAMember.selector);
        comadre.claimStake(key);
    }
}
