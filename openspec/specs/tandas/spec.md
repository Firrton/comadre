# Tandas Specification

## Purpose

Full tanda lifecycle in the mobile app: list, create, view detail, join (via deep link), start, and contribute. The app is a thin client — all on-chain actions route through the backend API with server-side signing via Privy.

## Requirements

### Requirement: Tanda List (Home Screen)

The app MUST display a paginated list of tandas the authenticated user belongs to.

#### Scenario: User has active tandas

- GIVEN the user is authenticated and has tandas
- WHEN the home screen loads
- THEN the app calls `GET /api/v1/tandas?limit=20&offset=0`
- AND renders a list showing each tanda's name, state, member count, and current turn

#### Scenario: Pull-to-refresh

- GIVEN the user is on the home screen with tandas loaded
- WHEN they pull to refresh
- THEN the app MUST re-fetch the tanda list via React Query's `refetch`
- AND update the UI with fresh data

#### Scenario: No tandas yet

- GIVEN the user is authenticated but belongs to no tandas
- WHEN the home screen loads and the API returns `{ tandas: [], total: 0 }`
- THEN the app MUST show an empty state with a CTA to create or join a tanda

#### Scenario: Pagination

- GIVEN the user has more than 20 tandas
- WHEN they scroll to the bottom of the list
- THEN the app MUST fetch the next page with `offset += 20`
- AND append results to the existing list

#### Scenario: Network error

- GIVEN the device has no connectivity
- WHEN the tanda list fetch fails
- THEN the app MUST show a retry prompt
- AND React Query MUST serve cached data if available

### Requirement: Create Tanda

The app MUST provide a form to create a new tanda with validation before calling the API.

#### Scenario: Valid tanda creation

- GIVEN the user taps "Create tanda"
- WHEN they fill in name, member_target, contribution_amount, stake_amount, frequency, and payout_order_mode
- THEN the app validates all fields (Zod schema mirroring `CreateTandaInput`)
- AND calls `POST /api/v1/tandas` with the validated payload
- AND on success navigates to the tanda detail screen

#### Scenario: Form validation failure

- GIVEN the user is on the create form
- WHEN they submit with invalid data (e.g., name > 32 chars, member_target outside 3-20)
- THEN the app MUST show inline validation errors
- AND MUST NOT make an API call

#### Scenario: Monetary amount input

- GIVEN the user enters contribution or stake amounts
- WHEN they type a decimal value (e.g., "10.50")
- THEN the app MUST convert to micro-USDC (multiply by 1_000_000) before sending
- AND display human-readable USDC values to the user

### Requirement: Tanda Detail

The app MUST display a tanda's full details including members and turn information.

#### Scenario: Valid tanda detail

- GIVEN the user taps a tanda from the list
- WHEN the detail screen loads
- THEN the app calls `GET /api/v1/tandas/:id`
- AND renders tanda metadata plus member list with turn numbers and contribution status

#### Scenario: Tanda not found

- GIVEN the user navigates to a tanda ID that does not exist
- WHEN the API returns 404
- THEN the app MUST show a "Tanda not found" error state

### Requirement: Join Tanda via Deep Link

The app MUST support joining a tanda via a deep link URL.

#### Scenario: Valid join deep link

- GIVEN the user taps a `comadre://join/:id` link
- WHEN the app opens and the user is authenticated
- THEN the app calls `GET /api/v1/tandas/:id` to preview
- AND shows a confirmation dialog
- AND on confirm calls `POST /api/v1/tandas/:id/join` with `{ tanda_id }`
- AND navigates to the tanda detail on success

#### Scenario: Invalid tanda ID in deep link

- GIVEN the user taps a deep link with a non-existent tanda ID
- WHEN the API returns 404
- THEN the app MUST show an error toast with "Tanda not found"

#### Scenario: Tanda full

- GIVEN the user taps a join link for a tanda at capacity
- WHEN the API returns 422 with `"Tanda is full"`
- THEN the app MUST show an error toast and disable the join button

#### Scenario: Tanda not in forming state

- GIVEN the user taps a join link for an active/completed tanda
- WHEN the API returns 422 with `"Tanda is not in forming state"`
- THEN the app MUST show an error toast: "This tanda is no longer accepting members"

#### Scenario: Unauthenticated deep link

- GIVEN the user taps a join link but is not authenticated
- WHEN the app opens to the deep link
- THEN the app MUST redirect to onboarding first
- AND after auth completes, resume the join flow

### Requirement: Start Tanda (Creator Only)

The app MUST allow the creator of a forming tanda to start it once enough members have joined.

#### Scenario: Creator starts tanda

- GIVEN the user is the creator of a forming tanda with enough members
- WHEN they tap "Start tanda"
- THEN the app calls `POST /api/v1/tandas/:id/start`
- AND navigates back to tanda detail showing `state: "active"`

#### Scenario: Non-creator attempts start

- GIVEN the user is a member (not the creator) of a forming tanda
- WHEN the API returns 403 `"Only the creator can start"`
- THEN the app MUST hide or disable the start button

#### Scenario: Not enough members

- GIVEN the creator taps "Start" but `member_current < member_target`
- WHEN the API returns 422 with member count message
- THEN the app MUST show a message: "Need X members, have Y"

### Requirement: Contribute to Current Turn

The app MUST allow a member to contribute to the current turn via a confirmation modal.

#### Scenario: Successful contribution

- GIVEN the user is an active member of an active tanda
- WHEN they tap "Contribute" and confirm in the modal
- THEN the app calls `POST /api/v1/tandas/:id/contribute` with `{ tanda_id }`
- AND shows a success feedback

#### Scenario: Already contributed this turn

- GIVEN the user already contributed for the current turn
- WHEN the tanda detail loads showing `contributions_made >= current_turn`
- THEN the app MUST disable the contribute button
- AND show "Already contributed this round"

#### Scenario: Not a member

- GIVEN the user views a tanda they are not a member of
- WHEN the tanda detail loads
- THEN the app MUST NOT show a contribute button

#### Scenario: Contribution on non-active tanda

- GIVEN the user is a member of a forming tanda
- WHEN they attempt to contribute
- THEN the app MUST hide the contribute action (only shown for `state: "active"`)

### Requirement: Tanda Error Boundary

Each tanda screen MUST be wrapped in an error boundary.

#### Scenario: Unhandled error on tanda screen

- GIVEN an unexpected error occurs on any tanda screen
- WHEN the error boundary catches it
- THEN the app MUST show a user-friendly error with a "Go back" action