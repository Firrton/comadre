// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {TestBase} from "../TestBase.t.sol";
import {Comadre} from "../../src/Comadre.sol";
import {ComadreErrors as E} from "../../src/libraries/ComadreErrors.sol";
import {ComadreTypes as T} from "../../src/libraries/ComadreTypes.sol";

/**
 * @title ComadreFuzz
 * @notice Property-based tests for `createTanda` and `joinTanda` covering the
 *         entire valid + invalid input space, plus a vault-accounting invariant.
 */
contract ComadreFuzzTest is TestBase {
    Comadre internal comadre;
    bytes2 internal constant AR = 0x4152;

    function setUp() public override {
        super.setUp();
        vm.prank(admin);
        comadre = new Comadre(usdc, kycOracle, crank, DEFAULT_FEE_BPS, feeDest, defaultKycLimits);

        // Onboard every actor as T1Lite so they can create / join tandas.
        address[6] memory people = [alice, bob, carol, dave, eve, frank];
        for (uint256 i = 0; i < people.length; i++) {
            comadre.initUserProfile(people[i], keccak256(abi.encodePacked(people[i])), AR);
            vm.prank(kycOracle);
            comadre.updateKycTier(people[i], T.KycTier.T1Lite);
        }
    }

    // ---------------------------------------------------------------------
    // createTanda — accepts valid input space, rejects everything else
    // ---------------------------------------------------------------------

    function testFuzz_createTanda_acceptsValidInputs(
        uint8 memberTarget,
        uint128 contributionAmount,
        uint128 stakeAmount,
        uint32 frequencySeconds
    ) public {
        vm.assume(memberTarget >= T.MIN_MEMBERS && memberTarget <= T.MAX_MEMBERS);
        vm.assume(contributionAmount > 0 && contributionAmount < type(uint64).max);
        vm.assume(stakeAmount > 0 && stakeAmount < type(uint64).max);
        vm.assume(frequencySeconds >= T.MIN_FREQUENCY);

        vm.prank(alice);
        bytes32 key = comadre.createTanda(
            1, bytes32("name"), memberTarget, contributionAmount, stakeAmount, frequencySeconds, T.PayoutOrder.JoinOrder
        );

        T.Tanda memory t = comadre.getTanda(key);
        assertEq(t.memberTarget, memberTarget);
        assertEq(t.contributionAmount, contributionAmount);
        assertEq(t.stakeAmount, stakeAmount);
        assertEq(t.frequencySeconds, frequencySeconds);
        assertEq(uint8(t.state), uint8(T.TandaState.Forming));
    }

    function testFuzz_createTanda_rejectsInvalidMemberCount(uint8 memberTarget) public {
        vm.assume(memberTarget < T.MIN_MEMBERS || memberTarget > T.MAX_MEMBERS);

        vm.prank(alice);
        vm.expectRevert(E.InvalidMemberCount.selector);
        comadre.createTanda(
            1, bytes32("name"), memberTarget, 10_000_000, 5_000_000, T.MIN_FREQUENCY, T.PayoutOrder.JoinOrder
        );
    }

    function testFuzz_createTanda_rejectsInvalidFrequency(uint32 frequencySeconds) public {
        vm.assume(frequencySeconds < T.MIN_FREQUENCY);

        vm.prank(alice);
        vm.expectRevert(E.InvalidFrequency.selector);
        comadre.createTanda(
            1, bytes32("name"), 3, 10_000_000, 5_000_000, frequencySeconds, T.PayoutOrder.JoinOrder
        );
    }

    // ---------------------------------------------------------------------
    // joinTanda — KYC headroom enforcement on arbitrary amounts
    // ---------------------------------------------------------------------

    function testFuzz_joinTanda_revertsWhenContribPlusStakeExceedsKycLimit(uint128 stakeAmount) public {
        // T1Lite limit in TestBase is 200 USDC = 200_000_000 micros.
        // Choose stake so that contrib(10) + stake > 200 USDC.
        vm.assume(stakeAmount > 190_000_000);
        vm.assume(stakeAmount < type(uint64).max);

        vm.prank(alice);
        bytes32 key = comadre.createTanda(
            1, bytes32("name"), 3, 10_000_000, stakeAmount, T.MIN_FREQUENCY, T.PayoutOrder.JoinOrder
        );

        usdc.mint(bob, stakeAmount);
        vm.prank(bob);
        usdc.approve(address(comadre), stakeAmount);
        vm.prank(bob);
        vm.expectRevert(E.KycInsufficientForAmount.selector);
        comadre.joinTanda(key, 0);
    }

    // ---------------------------------------------------------------------
    // Invariant — vault accounting
    //
    // For any single tanda after any sequence of joins / contributes / payouts:
    //   `Tanda.vaultBalance` is the contract's claim against `usdc.balanceOf(comadre)`
    //   for that tanda. The sum across all tandas can never exceed the contract's
    //   USDC balance. This test runs the happy-path flow and asserts the equality
    //   at each step.
    // ---------------------------------------------------------------------

    function test_vaultAccounting_neverOverpaysOnHappyPath() public {
        vm.prank(alice);
        bytes32 key = comadre.createTanda(
            1, bytes32("name"), 3, 10_000_000, 5_000_000, T.MIN_FREQUENCY, T.PayoutOrder.JoinOrder
        );

        address[3] memory joiners = [bob, carol, dave];
        for (uint256 i = 0; i < joiners.length; i++) {
            vm.prank(joiners[i]);
            usdc.approve(address(comadre), 5_000_000);
            vm.prank(joiners[i]);
            comadre.joinTanda(key, 0);
            assertEq(uint256(comadre.getTanda(key).vaultBalance), usdc.balanceOf(address(comadre)));
        }

        vm.prank(alice);
        comadre.startTanda(key);

        for (uint8 turn = 0; turn < 3; turn++) {
            for (uint256 i = 0; i < joiners.length; i++) {
                vm.prank(joiners[i]);
                usdc.approve(address(comadre), 10_000_000);
                vm.prank(joiners[i]);
                comadre.contribute(key);
            }
            vm.warp(block.timestamp + T.MIN_FREQUENCY);
            vm.prank(crank);
            comadre.payout(key);
            assertEq(uint256(comadre.getTanda(key).vaultBalance), usdc.balanceOf(address(comadre)));
        }

        // After everyone claims their stake, vault should be zero AND contract holds nothing.
        for (uint256 i = 0; i < joiners.length; i++) {
            vm.prank(joiners[i]);
            comadre.claimStake(key);
        }
        assertEq(comadre.getTanda(key).vaultBalance, 0);
        assertEq(usdc.balanceOf(address(comadre)), 0);
    }
}
