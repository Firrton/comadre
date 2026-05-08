# @comadre/api

Hono 4 REST API for Comadre. Port 3001. Auth via Privy JWT. Builds unsigned Solana txs for client signing.

## Run locally

```bash
cp ../../.env.example .env.local   # fill in values
bun run dev                         # starts with --hot reload
```

## Run tests

```bash
bun test
```

Tests use `.env.test` with stub values and bypass Redis/DB (`SKIP_REDIS=true`, `NODE_ENV=test`).

## Env vars

See `packages/config/src/env.ts` for full schema. Key vars:

| Variable | Purpose |
|---|---|
| `PORT` | Server port (default: 3001) |
| `PRIVY_APP_ID` / `PRIVY_APP_SECRET` | JWT verification |
| `DATABASE_URL` | Postgres (Drizzle) |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Rate limiting + idempotency |
| `SUMSUB_APP_TOKEN` / `SUMSUB_WEBHOOK_SECRET` | KYC |
| `HELIUS_WEBHOOK_SECRET` | Helius webhook auth |
| `SKIP_REDIS=true` | Bypass Redis in test/dev |

## Dev-mode auth

In `NODE_ENV !== production`, skip Privy with:

```
X-Dev-Wallet: <solana-pubkey>
X-Dev-User-Id: <string>
```

## Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | /health | liveness, no auth |
| POST | /api/v1/users/init | stub tx |
| POST | /api/v1/users/:wallet/confirm | inserts DB row |
| GET | /api/v1/users/me | reads Postgres |
| POST | /api/v1/tandas | stub tx |
| GET | /api/v1/tandas | paginated list |
| GET | /api/v1/tandas/:id | with members[] |
| POST | /api/v1/tandas/:id/join | stub tx |
| POST | /api/v1/tandas/:id/start | stub tx |
| POST | /api/v1/tandas/:id/contribute | stub tx |
| POST | /api/v1/tandas/:id/disputes | stub tx |
| POST | /api/v1/disputes/:id/vote | stub tx |
| GET | /api/v1/disputes/:id | vote tallies |
| POST | /api/v1/kyc/session | stub until SUMSUB_APP_TOKEN set |
| POST | /api/v1/onramp/quote | mock rate |
| POST | /api/v1/offramp/quote | mock rate |
| POST | /webhooks/sumsub | HMAC-verified |
| POST | /webhooks/privy | stub |
| POST | /webhooks/helius | log only |

## Tx-build stubs

All tx-build endpoints return `{ unsigned_tx: "<base64>", idempotency_key: "<uuid>", plan: {...} }`.
`plan` documents the intended Anchor instruction. Swap `unsigned_tx` for the real VersionedTransaction
once `@comadre/anchor-client` is wired after program deploy.
