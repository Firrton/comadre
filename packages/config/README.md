# @comadre/config

Zod-based environment variable loader with fail-fast validation. Every service in the monorepo imports a pre-validated singleton rather than reading `process.env` directly.

## Usage

```ts
import { env } from "@comadre/config";

// Fully typed — TS infers the type from the Zod schema.
console.log(env.DATABASE_URL);  // string (validated URL)
console.log(env.SOLANA_CLUSTER); // "devnet" | "mainnet-beta" | "testnet" | "localnet"
```

Importing the module validates `process.env` immediately. If any required variable is missing or malformed, the process exits with a clear, colorized error listing every problem.

## Lazy validation

```ts
import { loadEnv } from "@comadre/config";

const env = loadEnv(); // idempotent — safe to call multiple times
```

## Variables

See `.env.example` at the repo root for the full list. Groups:
- **Solana** — cluster, RPC/WS URLs, program ID, USDC mint
- **Wallets** — base58 secret keys (fee payer, crank, KYC oracle, admin)
- **Privy** — app auth
- **Sumsub** — KYC
- **Meta WhatsApp** — Cloud API credentials
- **Anthropic** — API key, model
- **Helius** — API key, webhook secret
- **Postgres** — connection URLs
- **Upstash Redis** — REST URL + token
- **Internal auth** — HMAC secret for service-to-service calls
- **Service URLs** — internal API, WA, Agent, Indexer
- **Observability** — Sentry DSN, BetterStack token (optional)
- **ElevenLabs** — Phase 2 voice features (optional)
- **App** — NODE_ENV, LOG_LEVEL
