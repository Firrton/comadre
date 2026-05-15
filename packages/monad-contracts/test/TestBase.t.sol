// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

/**
 * @title TestBase
 * @notice Shared fixture for every Comadre test suite.
 *
 *         Provides a deterministic actor cast (admin/oracle/crank/feeDest +
 *         alice/bob/carol/dave/eve/frank), a fresh MockUSDC with 1M minted to
 *         each user, and small helpers for time/balance assertions.
 *
 *         Test files extend this contract and call `setUp()` via `super.setUp()`
 *         if they need to add their own arrangement.
 */
abstract contract TestBase is Test {
    // ---------------------------------------------------------------------
    // Actors
    // ---------------------------------------------------------------------
    address internal admin       = makeAddr("admin");
    address internal kycOracle   = makeAddr("kycOracle");
    address internal crank       = makeAddr("crank");
    address internal feeDest     = makeAddr("feeDest");

    address internal alice       = makeAddr("alice");
    address internal bob         = makeAddr("bob");
    address internal carol       = makeAddr("carol");
    address internal dave        = makeAddr("dave");
    address internal eve         = makeAddr("eve");
    address internal frank       = makeAddr("frank");

    // ---------------------------------------------------------------------
    // Fixtures
    // ---------------------------------------------------------------------
    MockUSDC internal usdc;

    /// @notice Default per-user USDC mint at setUp (1,000,000 USDC = 1e12 micros).
    uint256 internal constant DEFAULT_USDC_PER_USER = 1_000_000 * 1e6;

    /// @notice KYC limits used in every test unless overridden.
    /// T0Demo=1 USDC (micro-only), T1Lite=200, T2Standard=2_000, T3Pro=20_000 USDC.
    /// T0Demo permits demo-scale operations but cannot create/join real tandas
    /// (gated separately by `kycTier >= T1Lite` in createTanda).
    uint64[4] internal defaultKycLimits = [uint64(1_000_000), 200_000_000, 2_000_000_000, 20_000_000_000];

    /// @notice Default protocol fee (0.5%).
    uint16 internal constant DEFAULT_FEE_BPS = 50;

    function setUp() public virtual {
        usdc = new MockUSDC();
        vm.label(address(usdc), "USDC");

        address[6] memory users = [alice, bob, carol, dave, eve, frank];
        for (uint256 i = 0; i < users.length; i++) {
            usdc.mint(users[i], DEFAULT_USDC_PER_USER);
        }
    }

    // ---------------------------------------------------------------------
    // Time helpers
    // ---------------------------------------------------------------------

    /// @notice Advance block.timestamp by `seconds_` and mine one block.
    function _warpForward(uint256 seconds_) internal {
        vm.warp(block.timestamp + seconds_);
    }

    // ---------------------------------------------------------------------
    // Assertions
    // ---------------------------------------------------------------------

    function _assertUsdcBalance(address who, uint256 expected) internal view {
        assertEq(usdc.balanceOf(who), expected, "unexpected USDC balance");
    }
}
