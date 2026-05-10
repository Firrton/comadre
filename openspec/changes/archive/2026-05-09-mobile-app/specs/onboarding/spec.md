# Onboarding Specification

## Purpose

Phone-based authentication via Privy OTP with automatic Solana embedded wallet creation. The mobile app NEVER signs transactions directly — all signing is server-side via Privy. The app authenticates with Privy OTP, receives a JWT, and uses it as a Bearer token for all API calls.

## Requirements

### Requirement: Phone Input and OTP Request

The app MUST present a phone input screen that collects an E.164 phone number and sends an OTP via the Privy SDK.

#### Scenario: Valid phone submits OTP

- GIVEN the user is on the onboarding screen
- WHEN they enter a valid E.164 phone number and submit
- THEN the app calls `loginWithSms` from `@privy-io/expo`
- AND shows a verification code input screen

#### Scenario: Invalid phone format

- GIVEN the user is on the onboarding screen
- WHEN they enter a non-E.164 number (missing country code, invalid digits)
- THEN the app MUST show a validation error before calling Privy
- AND MUST NOT make a network request

### Requirement: OTP Verification and Session Creation

The app MUST verify the OTP code with Privy and persist the resulting JWT as the authentication session.

#### Scenario: Correct OTP code

- GIVEN the user has received an OTP via SMS
- WHEN they enter the correct code
- THEN Privy returns an `accessToken` (JWT)
- AND the app stores it in `expo-secure-store`
- AND the app navigates to the home screen

#### Scenario: Incorrect OTP code

- GIVEN the user has received an OTP via SMS
- WHEN they enter an incorrect code
- THEN the app MUST display an error message
- AND MUST NOT store any token

#### Scenario: OTP timeout

- GIVEN the OTP was sent more than N seconds ago (Privy-defined TTL)
- WHEN the user submits a code
- THEN the app MUST show an expired-code error
- AND MUST offer a "Resend" action

#### Scenario: Resend OTP

- GIVEN the user requests a resend
- WHEN they tap "Resend code"
- THEN the app calls `loginWithSms` again with the same phone number
- AND resets the timeout counter

### Requirement: Embedded Wallet Auto-Creation

Upon first Privy authentication, the system MUST create a Solana embedded wallet for the user via `POST /api/v1/onboarding/init`.

#### Scenario: New user first login

- GIVEN the user successfully verifies OTP for the first time
- WHEN the app calls `POST /api/v1/onboarding/init` with `{ phone }`
- THEN the response returns `{ walletAddress, walletId, alreadyExisted: false }`
- AND the app stores `walletAddress` locally for display

#### Scenario: Returning user login

- GIVEN a user who already has a Privy account
- WHEN the app calls `POST /api/v1/onboarding/init` with `{ phone }`
- THEN the response returns `{ walletAddress, walletId, alreadyExisted: true }`
- AND the app proceeds to home without re-onboarding

### Requirement: Auth Token Management

The app MUST include the Privy JWT as a Bearer token on all authenticated API calls and handle 401 responses.

#### Scenario: Authenticated API request

- GIVEN the user has a valid JWT stored in SecureStore
- WHEN the app makes any API call
- THEN the request MUST include `Authorization: Bearer <jwt>`

#### Scenario: Expired or invalid JWT (401 response)

- GIVEN the stored JWT has expired or is invalid
- WHEN any API call returns HTTP 401
- THEN the app MUST redirect the user to the onboarding screen
- AND MUST clear the stored JWT from SecureStore

#### Scenario: No network connectivity

- GIVEN the device has no internet connection
- WHEN the app attempts an API call during onboarding
- THEN the app MUST show a network error state
- AND MUST NOT clear local data

### Requirement: Onboarding Error Boundary

The onboarding flow MUST be wrapped in an error boundary to catch unexpected errors.

#### Scenario: Unhandled error during onboarding

- GIVEN an unexpected error occurs during the onboarding flow
- WHEN the error boundary catches it
- THEN the app MUST show a user-friendly error screen
- AND MUST offer a "Try again" action that restarts the onboarding flow