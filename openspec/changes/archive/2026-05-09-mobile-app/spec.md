# Delta Specs: mobile-app

Three NEW capabilities (no existing specs to modify).

| Domain | Type | Requirements | Scenarios |
|--------|------|-------------|-----------|
| onboarding | New | 5 | 10 |
| tandas | New | 7 | 20 |
| profile | New | 3 | 9 |

Full specs are in `specs/{domain}/spec.md`:
- [`specs/onboarding/spec.md`](specs/onboarding/spec.md) — Auth, OTP, wallet creation, token management, error boundary
- [`specs/tandas/spec.md`](specs/tandas/spec.md) — List, create, detail, join (deep link), start, contribute, error boundary
- [`specs/profile/spec.md`](specs/profile/spec.md) — Data display, KYC upgrade, error/loading states