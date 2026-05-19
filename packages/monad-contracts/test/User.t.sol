// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {TestBase} from "./TestBase.t.sol";
import {Comadre} from "../src/Comadre.sol";
import {ComadreErrors as E} from "../src/libraries/ComadreErrors.sol";
import {ComadreTypes as T} from "../src/libraries/ComadreTypes.sol";

contract UserTest is TestBase {
    Comadre internal comadre;

    bytes32 internal constant SAMPLE_PHONE_HASH = keccak256(abi.encodePacked("+5491112345678"));
    bytes2 internal constant AR = 0x4152; // "AR"

    function setUp() public override {
        super.setUp();
        vm.prank(admin);
        comadre = new Comadre(usdc, kycOracle, crank, DEFAULT_FEE_BPS, feeDest, defaultKycLimits);
    }

    function test_initUserProfile_happyPath() public {
        vm.expectEmit(true, false, false, true);
        emit Comadre.UserProfileInitialized(alice, SAMPLE_PHONE_HASH, AR, uint64(block.timestamp));

        vm.prank(alice);
        comadre.initUserProfile(alice, SAMPLE_PHONE_HASH, AR);

        T.UserProfile memory p = comadre.getUserProfile(alice);
        assertTrue(p.exists);
        assertEq(p.phoneHash, SAMPLE_PHONE_HASH);
        assertEq(uint8(p.kycTier), uint8(T.KycTier.T0Demo));
        assertEq(p.countryCode, AR);
        assertEq(p.createdAt, uint64(block.timestamp));
    }

    function test_initUserProfile_revertsWhenAlreadyInitialised() public {
        vm.prank(alice);
        comadre.initUserProfile(alice, SAMPLE_PHONE_HASH, AR);

        vm.prank(alice);
        vm.expectRevert(E.AlreadyInitialized.selector);
        comadre.initUserProfile(alice, SAMPLE_PHONE_HASH, AR);
    }

    function test_initUserProfile_revertsWhenPaused() public {
        vm.prank(admin);
        comadre.pause(true);

        vm.prank(alice);
        vm.expectRevert(E.ProgramPaused.selector);
        comadre.initUserProfile(alice, SAMPLE_PHONE_HASH, AR);
    }

    function test_initUserProfile_revertsWhenCallerIsNotWallet() public {
        // HIGH-06: msg.sender must equal the wallet being initialized.
        vm.prank(bob);
        vm.expectRevert(E.Unauthorized.selector);
        comadre.initUserProfile(alice, SAMPLE_PHONE_HASH, AR);
    }

    function test_updateKycTier_oracleUpgrades() public {
        vm.prank(alice);
        comadre.initUserProfile(alice, SAMPLE_PHONE_HASH, AR);

        vm.expectEmit(true, false, false, true);
        emit Comadre.KycTierUpdated(alice, uint8(T.KycTier.T2Standard), uint64(block.timestamp));

        vm.prank(kycOracle);
        comadre.updateKycTier(alice, T.KycTier.T2Standard);

        T.UserProfile memory p = comadre.getUserProfile(alice);
        assertEq(uint8(p.kycTier), uint8(T.KycTier.T2Standard));
    }

    function test_updateKycTier_oracleDowngrades() public {
        vm.prank(alice);
        comadre.initUserProfile(alice, SAMPLE_PHONE_HASH, AR);

        vm.prank(kycOracle);
        comadre.updateKycTier(alice, T.KycTier.T3Pro);
        vm.prank(kycOracle);
        comadre.updateKycTier(alice, T.KycTier.T1Lite);

        T.UserProfile memory p = comadre.getUserProfile(alice);
        assertEq(uint8(p.kycTier), uint8(T.KycTier.T1Lite));
    }

    function test_updateKycTier_revertsWhenCallerNotOracle() public {
        vm.prank(alice);
        comadre.initUserProfile(alice, SAMPLE_PHONE_HASH, AR);

        vm.prank(alice);
        vm.expectRevert(E.Unauthorized.selector);
        comadre.updateKycTier(alice, T.KycTier.T1Lite);
    }

    function test_updateKycTier_revertsWhenProfileMissing() public {
        vm.prank(kycOracle);
        vm.expectRevert(E.ProfileNotFound.selector);
        comadre.updateKycTier(alice, T.KycTier.T1Lite);
    }

    function test_updateKycTier_revertsWhenPaused() public {
        vm.prank(alice);
        comadre.initUserProfile(alice, SAMPLE_PHONE_HASH, AR);

        vm.prank(admin);
        comadre.pause(true);

        vm.prank(kycOracle);
        vm.expectRevert(E.ProgramPaused.selector);
        comadre.updateKycTier(alice, T.KycTier.T1Lite);
    }
}
