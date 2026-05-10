# Design: Mobile App — Comadre Android APK

## Technical Approach

Expo SDK 52 + expo-router thin client. All on-chain actions route through backend API (Privy server-side signing). JWT from Privy OTP stored in `expo-secure-store`, sent as Bearer. React Query for server state, React Context for auth state, NativeWind for styling. Reuses `@comadre/types` Zod schemas for API contract validation.

## Architecture Decisions

| Decision | Option | Tradeoff | Choice |
|----------|--------|----------|--------|
| Form validation | useState + Zod (from @comadre/types) vs react-hook-form | No extra dep, shared schemas, 2-3 forms only | useState + Zod |
| API client | Singleton fetch wrapper vs axios | Zero deps, native fetch handles Bearer + 401 intercept | Singleton fetch |
| Route grouping | `(auth)/` + `(tabs)/` vs flat routes | expo-router convention, auth gate at `index.tsx` | Grouped layouts |
| Mock mode | `EXPO_PUBLIC_USE_MOCK` env flag vs separate mock build | Single codebase, toggleable for demo | Env flag |
| Error boundaries | Per-screen ErrorBoundary component + 401 global intercept | Screen isolation, auth expiry handled globally | Both layers |
| Auth state | React Context vs Zustand | Already have React, simple state machine (5 states) | React Context |

## Auth State Machine

```
logged_out ──[submit phone]──→ otp_sent
    ↑                              ↓
    │                         [verify code]
    │                      ┌───────┴────────┐
    │                    wrong            correct
    │                      ↓                  ↓
    │                  otp_sent          authenticated ──[401]──→ (clear token → logged_out)
    │                      ↑
    │                 [resend / expired]
```

States: `idle` | `sending_otp` | `otp_sent` | `verifying` | `authenticated` | `error`

## Data Flow

```
Privy SDK (@privy-io/expo)
    │ loginWithSms → accessToken (JWT)
    ▼
expo-secure-store (persisted JWT)
    │
    ▼
api/client.ts — reads JWT, adds Authorization: Bearer, intercepts 401
    │
    ├──→ useTandas()    ──→ GET  /api/v1/tandas
    ├──→ useTanda(id)   ──→ GET  /api/v1/tandas/:id
    ├──→ useProfile()   ──→ GET  /api/v1/users/me
    ├──→ useCreateTanda()──→ POST /api/v1/tandas
    ├──→ useJoinTanda() ──→ POST /api/v1/tandas/:id/join
    ├──→ useContribute()──→ POST /api/v1/tandas/:id/contribute
    └──→ useKycSession()──→ POST /api/v1/kyc/session
    │
    ▼
Screens consume hooks → render loading/error/empty/data states
```

## Route Structure

```
app/
├── _layout.tsx              # Root: PrivyProvider + QueryProvider + Stack
├── index.tsx                # Auth gate: redirect → (tabs) or (auth)
├── (auth)/
│   └── onboarding.tsx       # PhoneInput → OtpInput → onboarding/init
├── (tabs)/
│   ├── _layout.tsx          # Bottom tabs: Home (list) + Profile
│   ├── index.tsx            # Home: TandaList + pull-to-refresh + pagination
│   └── profile.tsx          # Profile: stats + KYC + reputation
├── tandas/
│   ├── create.tsx           # TandaForm (Zod-validated)
│   └── [id].tsx             # Detail: members, turns, contribute, start
└── join/
    └── [id].tsx             # Deep link entry: preview → confirm join
```

## Component Tree

```
RootLayout (_layout.tsx)
├── QueryProvider (@tanstack/react-query)
│   └── AuthProvider (Privy + token context)
│       └── Stack
│           ├── AuthGate (index.tsx)
│           ├── OnboardingScreen
│           │   ├── PhoneInput (E.164 validation, uses E164Phone schema)
│           │   └── OtpInput (6-digit, resend timer, error display)
│           ├── TabNavigator
│           │   ├── HomeScreen
│           │   │   ├── TandaList (FlatList, pull-to-refresh, infinite scroll)
│           │   │   │   └── TandaCard (name, state badge, members, turn)
│           │   │   └── EmptyState (CTA: create or join)
│           │   └── ProfileScreen
│           │       ├── ProfileHeader (wallet truncated + copy)
│           │       ├── StatsGrid (completed | defaulted)
│           │       ├── ReputationBar (0-1000 progress)
│           │       └── KycBadge (tier label + upgrade CTA)
│           ├── CreateTandaScreen
│           │   └── TandaForm (Zod schema from @comadre/types)
│           ├── TandaDetailScreen
│           │   ├── TandaHeader (name, state, turn)
│           │   ├── MemberList → MemberRow (wallet, turn#, contributed?)
│           │   ├── ContributeButton (modal confirm → POST contribute)
│           │   └── StartButton (creator + forming only)
│           └── JoinTandaScreen
│               ├── TandaPreview (fetched detail)
│               └── JoinConfirm (POST join → navigate)
├── UI primitives (src/components/ui/): Button, Input, Card, Toast, Modal
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/mobile/app/_layout.tsx` | Modify | Add providers: QueryClientProvider, AuthProvider, PrivyProvider |
| `apps/mobile/app/index.tsx` | Create | Auth gate: check token → redirect to tabs or onboarding |
| `apps/mobile/app/(auth)/onboarding.tsx` | Create | Phone input + OTP verification flow |
| `apps/mobile/app/(tabs)/_layout.tsx` | Create | Bottom tab navigator (Home, Profile) |
| `apps/mobile/app/(tabs)/index.tsx` | Create | Home screen: tanda list with pull-to-refresh + empty state |
| `apps/mobile/app/(tabs)/profile.tsx` | Create | Profile: KYC tier, reputation, stats, wallet address |
| `apps/mobile/app/tandas/create.tsx` | Create | Create tanda form with Zod validation |
| `apps/mobile/app/tandas/[id].tsx` | Create | Tanda detail: members, turns, contribute, start |
| `apps/mobile/app/join/[id].tsx` | Create | Deep link join: preview → confirm join |
| `apps/mobile/src/api/client.ts` | Create | Fetch wrapper: JWT header, 401 intercept, base URL |
| `apps/mobile/src/hooks/useAuth.ts` | Create | Auth context: login, verifyOtp, logout, token state |
| `apps/mobile/src/hooks/useTandas.ts` | Create | React Query hooks: list, detail, create, join, contribute, start |
| `apps/mobile/src/hooks/useProfile.ts` | Create | React Query hook: profile + KYC session |
| `apps/mobile/src/providers/AuthProvider.tsx` | Create | Privy init + token persistence + auth context |
| `apps/mobile/src/providers/QueryProvider.tsx` | Create | QueryClient with retry/stale config |
| `apps/mobile/src/components/ui/` | Create | Button, Input, Card, Toast, Modal, Skeleton |
| `apps/mobile/src/components/TandaCard.tsx` | Create | Tanda list item card |
| `apps/mobile/src/components/MemberRow.tsx` | Create | Member list row (wallet, turn, status) |
| `apps/mobile/src/components/EmptyState.tsx` | Create | No-data placeholder with CTA |
| `apps/mobile/src/components/ErrorBoundary.tsx` | Create | Per-screen error catcher with retry |
| `apps/mobile/src/lib/constants.ts` | Create | API_URL, Privy app ID, config |
| `apps/mobile/src/lib/errors.ts` | Create | Error type guards + user-facing messages |
| `apps/mobile/app.json` | Modify | Add MWA intent filters, deep link config |

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit | Zod schemas, form validation, error mapping | Jest + schema.parse assertions |
| Unit | API client (mock fetch), auth state machine | Jest + fetch mock |
| Integration | React Query hooks (mock API client) | Jest + renderHook |
| Integration | Screen rendering (loading/empty/error/data) | Jest + React Native Testing Library |
| Manual | Privy OTP flow, deep links, real device | Expo Go + physical Android |

## Open Questions

- [ ] Privy App ID and credentials: confirm team `.env` values before implementation
- [ ] Backend `/api/v1/onboarding/init` endpoint: verify merged from `feat/onboarding-flow`
- [ ] EAS build configuration: verify Android credentials in Expo dashboard
- [ ] Mock mode: confirm `POST /api/v1/tandas` mock response shape matches real API during demo

## Rollout

No migration. Branch `feat/mobile-app` branched from `main`, merging `feat/onboarding-flow` for the `/onboarding/init` endpoint. Deploy via EAS Build → Android APK.
