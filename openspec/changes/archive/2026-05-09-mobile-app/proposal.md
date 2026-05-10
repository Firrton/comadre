# Proposal: Mobile App — Comadre Android APK

## Intent

Build the Comadre React Native app (Android APK) for Dev3pack Hackathon (deadline May 10 8am UTC). Enables LATAM users to create/join tandas (rotating savings), manage USDC, and track reputation via Privy OTP auth. Targets: Best App Overall ($3K), Solana Mobile ($3K), ElevenLabs ($1,980).

## Scope

### In Scope
- **Onboarding**: Privy OTP → embedded Solana wallet → JWT to API
- **Home**: Tanda list (GET /api/v1/tandas), balance, activity
- **Create Tanda**: Form → POST /api/v1/tandas (stub tx)
- **Tanda Detail**: Members + turns → GET /api/v1/tandas/:id
- **Join Tanda**: Deep link `comadre://join/:id` → POST join
- **Contribute**: Modal → POST /api/v1/tandas/:id/contribute
- **Profile**: KYC tier, reputation → GET /api/v1/users/me
- **Mobile Wallet Adapter**: Register for Solana dApp Store

### Out of Scope
- P2P Transfer screen (API exists, deferred)
- ElevenLabs voice TTS (nice-to-have, post-MVP)
- KYC flow, push notifications, disputes, ramps, iOS

## Capabilities

### New Capabilities
- `onboarding`: Privy OTP auth, embedded Solana wallet, JWT session management
- `tandas`: List, create, join, detail, contribute — consuming backend REST stubs
- `profile`: Display KYC tier, reputation score, stats from /users/me

### Modified Capabilities
None (first mobile build)

## Approach

**Client**: Expo Router (file-based) + React Query (server state) + NativeWind (Tailwind). Thin client — never signs transactions. All on-chain actions route through backend API (Privy server-side signing). JWT from Privy OTP stored in `expo-secure-store`, sent as Bearer token.

**Screens**: `app/(onboarding)/`, `app/(tabs)/home`, `app/tanda/[id]`, `app/create`, `app/profile`, `app/voice`.

**Data**: Custom hooks (`useTandas`, `useProfile`, `useContributions`) wrapping `@tanstack/react-query` + shared `@comadre/types`. Zod validation on forms.

**Auth flow**: `@privy-io/expo` → OTP → `loginWithSms` → `usePrivy` hook → stored JWT → `Authorization: Bearer` header.

**MWA**: `@solana-mobile/mobile-wallet-adapter-protocol-mobile` registered at root layout for dApp Store compliance.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/mobile/app/` | New | 8 screens + _layout wrappers (Privy, Query, MWA) |
| `apps/mobile/components/` | New | Shared UI: Button, Card, Input, TandaCard, BalanceDisplay |
| `apps/mobile/hooks/` | New | usePrivy, useTandas, useProfile, useApi |
| `apps/mobile/lib/` | New | api client, Privy config, MWA config, constants |
| `apps/mobile/app.json` | Modified | MWA intent filters, Android permissions |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Privy OTP fails in APK (emulator/web mismatch) | Medium | Test on physical device early; USE_MOCK flag for demo fallback |
| Backend down during demo | Medium | Conditional mock data via env flag; types already shared |
| EAS build slow/fails | Medium | Start build by hour 6; expo-dev-client for local testing |
| >400 line budget exceeded | High | Auto-chain into base-infra PR + screens PR |

## Rollback Plan

`git revert` the mobile-app branch. No DB migrations, no contract changes. Backend independent.

## Dependencies

- Backend API running (verify health before impl)
- Privy App ID + credentials (from team `.env`)
- Helius RPC URL (balance queries)
- EAS project configured for Android

## Success Criteria

- [ ] APK installs on Android device/emulator
- [ ] Privy OTP login → JWT → authenticated API calls
- [ ] Tanda list and detail screens render API data
- [ ] Create tanda form validates and calls POST
- [ ] Join tanda via deep link works
- [ ] Mobile Wallet Adapter registered (dApp Store ready)
- [ ] Profile screen shows KYC tier + reputation
