// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title ComadreErrors
 * @notice Custom errors used across the Comadre contract.
 *         Mirrors the Anchor errors enum 1:1 (same names), plus a few EVM-specific
 *         additions (`AlreadyInitialized`, `ProfileNotFound`, `TandaNotFound`,
 *         `DisputeNotFound`) where Anchor relied on PDA-not-found behavior.
 */
library ComadreErrors {
    // ----- Generic auth / control -----
    error Unauthorized();
    error ProgramPaused();
    error AlreadyInitialized();
    error ZeroAddress();

    // ----- Configuration -----
    error InvalidFeeBps();
    error InvalidKycLimits();

    // ----- User / KYC -----
    error InsufficientKyc();
    error ProfileNotFound();

    // ----- Tanda lifecycle -----
    error TandaNotForming();
    error TandaNotActive();
    error TandaPaused();
    error TandaFull();
    error TandaNotFound();
    error InvalidMemberCount();
    error InvalidStake();
    error InvalidFrequency();
    error TurnAlreadyTaken();
    error AlreadyContributed();
    error PayoutNotReady();
    error MissingContributions();
    error AlreadyPaidOut();
    error NotImplemented();
    error NotCreator();

    // ----- Membership -----
    error NotAMember();
    error MemberInactive();
    error MemberNotDefaulted();
    error KycInsufficientForAmount();

    // ----- Disputes -----
    error DisputeNotFound();
    error DisputeNotOpen();
    error DisputeExpired();
    error DisputeNotExpired();
    error DisputeStillOpen();
    error AlreadyVoted();
    error MaxDisputesReached();
    error DisputeTandaMismatch();

    // ----- Math (kept for parity; Solidity 0.8+ reverts on overflow by default) -----
    error MathOverflow();
}
