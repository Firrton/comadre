// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {TestBase} from "./TestBase.t.sol";
import {Comadre} from "../src/Comadre.sol";
import {ComadreErrors as E} from "../src/libraries/ComadreErrors.sol";
import {ComadreTypes as T} from "../src/libraries/ComadreTypes.sol";

contract AdminTest is TestBase {
    Comadre internal comadre;

    function setUp() public override {
        super.setUp();
        vm.prank(admin);
        comadre = new Comadre(usdc, kycOracle, crank, DEFAULT_FEE_BPS, feeDest, defaultKycLimits);
    }

    // ---------------------------------------------------------------------
    // Constructor bounds
    // ---------------------------------------------------------------------

    function test_constructor_setsRolesAndConfig() public view {
        assertEq(comadre.admin(), admin);
        assertEq(comadre.kycOracle(), kycOracle);
        assertEq(comadre.crankAuthority(), crank);
        assertEq(comadre.feeDestination(), feeDest);
        assertEq(comadre.feeBps(), DEFAULT_FEE_BPS);
        assertEq(address(comadre.usdc()), address(usdc));
        assertFalse(comadre.paused());

        uint64[4] memory limits = comadre.getKycLimits();
        for (uint256 i = 0; i < 4; i++) {
            assertEq(limits[i], defaultKycLimits[i]);
        }
    }

    function test_constructor_revertsWhenFeeBpsTooHigh() public {
        vm.expectRevert(E.InvalidFeeBps.selector);
        new Comadre(usdc, kycOracle, crank, T.MAX_FEE_BPS + 1, feeDest, defaultKycLimits);
    }

    function test_constructor_revertsWhenT0KycLimitIsZero() public {
        uint64[4] memory badLimits = [uint64(0), 0, 0, 0];
        vm.expectRevert(E.InvalidKycLimits.selector);
        new Comadre(usdc, kycOracle, crank, DEFAULT_FEE_BPS, feeDest, badLimits);
    }

    function test_constructor_revertsWhenKycLimitsNotMonotonic() public {
        uint64[4] memory badLimits = [uint64(100), 50, 200, 300];
        vm.expectRevert(E.InvalidKycLimits.selector);
        new Comadre(usdc, kycOracle, crank, DEFAULT_FEE_BPS, feeDest, badLimits);
    }

    // ---------------------------------------------------------------------
    // pause / unpause
    // ---------------------------------------------------------------------

    function test_pause_adminFlipsTrue() public {
        vm.prank(admin);
        comadre.pause(true);
        assertTrue(comadre.paused());
    }

    function test_pause_adminFlipsFalse() public {
        vm.prank(admin);
        comadre.pause(true);
        vm.prank(admin);
        comadre.pause(false);
        assertFalse(comadre.paused());
    }

    function test_pause_revertsWhenNotAdmin() public {
        vm.prank(alice);
        vm.expectRevert(E.Unauthorized.selector);
        comadre.pause(true);
    }

    function test_pause_emitsEvent() public {
        vm.expectEmit(false, false, false, true);
        emit Comadre.ProgramPausedSet(true);
        vm.prank(admin);
        comadre.pause(true);
    }

    // ---------------------------------------------------------------------
    // Role rotations
    // ---------------------------------------------------------------------

    function test_setAdmin_transfersAndEmits() public {
        address newAdmin = makeAddr("newAdmin");
        vm.expectEmit(true, true, false, false);
        emit Comadre.AdminChanged(admin, newAdmin);
        vm.prank(admin);
        comadre.setAdmin(newAdmin);
        assertEq(comadre.admin(), newAdmin);
    }

    function test_setKycOracle_changesAndEmits() public {
        address newOracle = makeAddr("newOracle");
        vm.expectEmit(true, true, false, false);
        emit Comadre.KycOracleChanged(kycOracle, newOracle);
        vm.prank(admin);
        comadre.setKycOracle(newOracle);
        assertEq(comadre.kycOracle(), newOracle);
    }

    function test_setCrankAuthority_changesAndEmits() public {
        address newCrank = makeAddr("newCrank");
        vm.expectEmit(true, true, false, false);
        emit Comadre.CrankAuthorityChanged(crank, newCrank);
        vm.prank(admin);
        comadre.setCrankAuthority(newCrank);
        assertEq(comadre.crankAuthority(), newCrank);
    }

    function test_setFeeDestination_changesAndEmits() public {
        address newDest = makeAddr("newDest");
        vm.expectEmit(true, true, false, false);
        emit Comadre.FeeDestinationChanged(feeDest, newDest);
        vm.prank(admin);
        comadre.setFeeDestination(newDest);
        assertEq(comadre.feeDestination(), newDest);
    }

    function test_setFeeBps_changesAndEmits() public {
        vm.expectEmit(false, false, false, true);
        emit Comadre.FeeBpsChanged(DEFAULT_FEE_BPS, 100);
        vm.prank(admin);
        comadre.setFeeBps(100);
        assertEq(comadre.feeBps(), 100);
    }

    function test_setFeeBps_revertsWhenTooHigh() public {
        vm.prank(admin);
        vm.expectRevert(E.InvalidFeeBps.selector);
        comadre.setFeeBps(T.MAX_FEE_BPS + 1);
    }

    function test_setters_revertWhenCallerIsNotAdmin() public {
        address newAddr = makeAddr("intruder");
        vm.startPrank(alice);

        vm.expectRevert(E.Unauthorized.selector);
        comadre.setAdmin(newAddr);

        vm.expectRevert(E.Unauthorized.selector);
        comadre.setKycOracle(newAddr);

        vm.expectRevert(E.Unauthorized.selector);
        comadre.setCrankAuthority(newAddr);

        vm.expectRevert(E.Unauthorized.selector);
        comadre.setFeeDestination(newAddr);

        vm.expectRevert(E.Unauthorized.selector);
        comadre.setFeeBps(100);

        vm.stopPrank();
    }
}
