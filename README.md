# 🌮 Comadre

> AI Agent Tía de LATAM — tandas, crédito social y ahorro en USDC vía WhatsApp y Solana Mobile.

Built for the **Solana Hackathon 2026** (tracks: Solana Mobile + ElevenLabs).

## Stack

| Capa | Tech |
|---|---|
| Smart contracts | Rust + Anchor 0.31 |
| Backend runtime | Bun 1.2+ |
| Web framework | Hono 4 |
| Lenguaje | TypeScript 5.7+ |
| ORM | Drizzle |
| DB | Postgres (Supabase) |
| Cache / queue | Redis (Upstash) |
| Mobile | React Native + Expo SDK 52 |
| Web | Next.js 15 |
| Auth | Privy (embedded wallets + Solana) |
| KYC | Sumsub |
| Voice | ElevenLabs Conversational AI (Fase 2) |
| Agent | Claude Sonnet 4.6 (`claude-sonnet-4-6`) |
| RPC | Helius |

## Estructura del monorepo

```
apps/
  api/          # Public API (Bun + Hono)
  whatsapp/     # Meta Cloud webhook + reply
  agent/        # Claude orchestration
  indexer/      # Helius webhook → DB
  cron/         # Scheduled jobs (payout crank, reminders)
  mobile/       # React Native + Expo (Solana Seeker)
  web/          # Next.js (landing + admin)

packages/
  anchor-program/  # Rust Anchor program (el smart contract)
  anchor-client/   # TS client codegen del IDL
  db/              # Drizzle schema + migrations
  types/           # Zod schemas compartidos
  solana/          # Tx builders, fee_payer, retry
  agent-tools/     # Claude tool definitions
  cache/           # Upstash Redis wrapper
  config/          # env loading

infra/         # Railway, Docker
scripts/       # Deploy, codegen, seed
docs/          # Arquitectura, data model, dev guide
```

## Quick start

```bash
bun install
cp .env.example .env.local      # llenar secrets
bun run db:migrate
bun run anchor:build
bun run dev                     # arranca todos los services
```

## Documentación

- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — diagrama completo del sistema
- [DATA_MODEL.md](docs/DATA_MODEL.md) — cuentas on-chain + tablas Postgres
- [DEVELOPMENT.md](docs/DEVELOPMENT.md) — setup local
- [CHECKLIST.md](CHECKLIST.md) — tareas para llegar al MVP

## Contributing

Ver [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
