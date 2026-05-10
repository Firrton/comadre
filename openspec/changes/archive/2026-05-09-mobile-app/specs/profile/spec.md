# Profile Specification

## Purpose

Display user profile data including KYC tier, reputation score, tanda stats, and wallet address. Provide KYC upgrade initiation. All data sourced from `GET /api/v1/users/me`.

## Requirements

### Requirement: Profile Data Display

The app MUST display the authenticated user's profile information from `GET /api/v1/users/me`.

#### Scenario: Profile with data

- GIVEN the user is authenticated and navigates to the profile screen
- WHEN the app calls `GET /api/v1/users/me` with Bearer token
- THEN the app renders: KYC tier, reputation score, tandas completed, country code, wallet address

#### Scenario: Wallet address display

- GIVEN the profile response includes the wallet address
- WHEN rendered on screen
- THEN the app MUST display it truncated (e.g., `AbCd...Xy9z`)
- AND provide a tap-to-copy action for the full address

#### Scenario: KYC tier labels

- GIVEN the API returns a `kyc_tier` value
- WHEN displayed on the profile screen
- THEN the app MUST map tier codes to human-readable labels:

| API Value | Display Label |
|-----------|---------------|
| `t0_demo` | Demo |
| `t1_lite` | Lite |
| `t2_standard` | Standard |
| `t3_pro` | Pro |

#### Scenario: Reputation score display

- GIVEN the API returns `reputation_score` (0-1000)
- WHEN rendered on screen
- THEN the app MUST display it as a numeric value with a visual progress indicator (e.g., progress bar or circular gauge)

#### Scenario: Tanda stats display

- GIVEN the API returns `tandas_completed` and `tandas_defaulted`
- WHEN rendered on screen
- THEN the app MUST show both values as numeric counters

#### Scenario: Profile not found

- GIVEN the user is authenticated but has no profile row
- WHEN `GET /api/v1/users/me` returns 404
- THEN the app MUST show a prompt to complete profile setup

### Requirement: KYC Upgrade Initiation

The app MUST allow users to start a KYC session to upgrade their tier.

#### Scenario: Start KYC session

- GIVEN the user taps "Upgrade verification" on the profile screen
- WHEN the app calls `POST /api/v1/kyc/session`
- THEN the app receives a session token and `session_id`
- AND navigates to the KYC provider (Sumsub) or shows a stub message

#### Scenario: KYC already at maximum tier

- GIVEN the user's `kyc_tier` is `t3_pro`
- WHEN the profile screen renders
- THEN the app MUST NOT show an upgrade CTA
- AND MAY show a verified badge

#### Scenario: KYC stub mode

- GIVEN the `POST /api/v1/kyc/session` response includes `"stub": true`
- WHEN the app processes the response
- THEN the app MUST display a "KYC coming soon" message instead of the provider flow

### Requirement: Profile Error and Loading States

The profile screen MUST handle loading, error, and offline states gracefully.

#### Scenario: Loading state

- GIVEN the user navigates to the profile screen
- WHEN the API call is in-flight
- THEN the app MUST show a loading skeleton or spinner

#### Scenario: Network error

- GIVEN the API call fails due to network error
- WHEN React Query's retry policy exhausts
- THEN the app MUST show an error state with a "Retry" button
- AND serve cached data if available

#### Scenario: Auth expired on profile

- GIVEN the stored JWT is expired
- WHEN `GET /api/v1/users/me` returns 401
- THEN the app MUST redirect to onboarding (per auth token management requirement)