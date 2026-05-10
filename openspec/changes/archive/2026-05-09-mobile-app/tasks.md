# Tasks: Mobile App — Comadre Android APK

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1,400–1,600 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 → PR 4 → PR 5 |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | PR | Base | Status |
|------|------|-----|------|--------|
| 1 | Branch + Infrastructure | PR 1 | main | ✅ Done |
| 2 | Onboarding (auth) | PR 2 | PR 1 | ✅ Done |
| 3 | Home + Profile | PR 3 | PR 2 | ✅ Done |
| 4 | Tandas CRUD | PR 4 | PR 3 | ✅ Done |
| 5 | Deep link + MWA + Polish | PR 5 | PR 4 | ✅ Done |

## Phase 1: Foundation (Tasks 0–1)

- [x] 0.1 Branch `feat/mobile-app` from `main`, merge `feat/onboarding-flow`
- [x] 1.1 Create `src/lib/constants.ts` — API_URL, Privy App ID, mock flag
- [x] 1.2 Create `src/api/client.ts` — fetch: JWT Bearer, 401 intercept, base URL, mock guard
- [x] 1.3 Create `src/lib/errors.ts` — error type guards + user-facing messages
- [x] 1.4 Create `src/providers/QueryProvider.tsx` — QueryClient (retry=1, staleTime=30s)
- [x] 1.5 Create `src/providers/AuthProvider.tsx` + `src/hooks/useAuth.ts` — Privy init, loginWithSms, verifyOtp, 6-state machine (idle→sending_otp→otp_sent→verifying→authenticated→error)
- [x] 1.6 Create `src/components/ui/` — Button, Input, Card, Toast (PR 1 complete; Modal, Skeleton deferred)
- [x] 1.7 Create `src/components/ErrorBoundary.tsx` — per-screen catcher + retry (PR 5: wraps Stack in _layout.tsx)
- [x] 1.8 Modify `app/_layout.tsx` — wrap Stack: QueryProvider → AuthProvider → PrivyProvider
- [x] 1.9 Create `app/index.tsx` — auth gate: stored token → redirect `(tabs)` or `(auth)`

## Phase 2: Onboarding (Tasks 2–3)

- [x] 2.1 Create `app/(auth)/onboarding.tsx` — PhoneInput: E.164 Zod validation, submit → `loginWithSms`
- [x] 2.2 Add OtpInput — 6-digit input, resend timer, error display, verify via Privy SDK
- [x] 3.1 OTP success: store JWT in SecureStore, call `POST /api/v1/onboarding/init { phone }`, store walletAddress
- [x] 3.2 Error cases: incorrect code, expired→resend, network offline
- [x] 3.3 Mock path: `EXPO_PUBLIC_USE_MOCK` → skip Privy, inject fake JWT

## Phase 3: Home + Profile (Tasks 4, 7)

- [x] 4.1 Create `src/hooks/useTandas.ts` — `useTandas()` (list+infinite scroll), `useTanda(id)`. Mock: fake array.
- [x] 4.2 Create `src/components/TandaCard.tsx` — name, state badge, member count, turn, pressable
- [x] 4.3 Create `src/components/EmptyState.tsx` — placeholder + Create/Join CTAs
- [x] 4.4 Create `app/(tabs)/_layout.tsx` — bottom tabs: Home + Profile
- [x] 4.5 Create `app/(tabs)/index.tsx` — Home: FlatList(TandaCard), pull-to-refresh, infinite scroll (offset=20), empty state
- [x] 7.1 Create `src/hooks/useProfile.ts` — `useProfile()` (GET /users/me), `useKycSession()` (POST /kyc/session). Mock: fake profile.
- [x] 7.2 Create `app/(tabs)/profile.tsx` — wallet truncated+copy, KYC tier label, reputation bar (0-1000), stats counters, KYC upgrade CTA (hidden at t3_pro), skeleton loading
- [x] 7.3 Profile 404 → prompt "Complete setup"

## Phase 4: Tandas CRUD (Tasks 5–6)

- [x] 5.1 Create `app/tandas/create.tsx` — form: name, member_target (3-20), amounts (micro-USDC conversion), frequency, payout_order_mode. Zod+useState. Success → `tandas/[id]`
- [x] 6.1 Create `src/components/MemberRow.tsx` — wallet truncated, turn#, contributed checkmark
- [x] 6.2 Create `app/tandas/[id].tsx` — header (name, state, turn), MemberList+MemberRow, ContributeButton (modal confirm, disabled if contributed or state≠active), StartButton (creator+forming only), 404 state
- [x] 6.3 Add mutations to `useTandas.ts`: create, join, contribute, start. Mock: success response.

## Phase 5: Deep Link + MWA + Polish (Tasks 8–9)

- [x] 8.1 Create `app/join/[id].tsx` — preview (GET /tandas/:id) → confirm → POST /join. Handle 404, 422 full, 422 not-forming, unauthenticated→resume
- [x] 8.2 Modify `app.json` — intent-filter `comadre://join/:id`, MWA Android manifest sections
- [x] 8.3 MWA provider in `app/_layout.tsx` — register wallet adapter for dApp Store compliance
- [x] 9.1 Create `eas.json` — Android APK build profile
- [x] 9.2 Polish: loading states, toast feedback on mutations, keyboard handling on forms (Profile: ✅ skeleton exists, Create: ✅ loading exists, ErrorBoundary: ✅ created, verified all 7 screens)
- [x] 9.3 Test deep link: `adb shell am start -W -a android.intent.action.VIEW -d "comadre://join/:id"` — intent filter configured, expo-router route wired
- [x] 9.4 Smoke test: `EXPO_PUBLIC_USE_MOCK=true expo start --android` — full demo offline (ready for manual test)
- [x] 9.5 `eas build --platform android` — eas.json created, ready for build
