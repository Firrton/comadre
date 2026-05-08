# Architecture

## Stack

| Capa | Tech | Versión |
|---|---|---|
| Smart contracts | Rust + Anchor | 0.31 |
| Backend runtime | Bun | 1.2+ |
| Web framework | Hono | 4.x |
| Lenguaje backend | TypeScript | 5.7+ |
| ORM | Drizzle | 0.36+ |
| DB | Postgres (Supabase) | 15 |
| Cache/queue | Redis (Upstash) | — |
| Mobile | React Native + Expo | SDK 52 |
| Web | Next.js | 15 (App Router) |
| Auth | Privy | latest |
| KYC | Sumsub | WebSDK 2 |
| WhatsApp | Meta Graph API | v22 |
| Agent LLM | Claude Sonnet 4.6 | `claude-sonnet-4-6` |
| Voice (Fase 2) | ElevenLabs Conv AI | latest |
| RPC Solana | Helius | — |

## Topología

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CLIENTES                                    │
│  📱 Solana Seeker (RN+Expo)  🌐 Web (Next.js)  💬 WhatsApp (Meta)   │
└────────┬────────────────┬────────────────────────┬──────────────────┘
         │                │                        │
         ▼                ▼                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     EDGE — Cloudflare                                │
└────────┬─────────────────────────┬────────────────┬─────────────────┘
         │                         │                │
         ▼                         ▼                ▼
┌──────────────────┐    ┌────────────────────┐   ┌──────────────────┐
│   API SERVICE    │    │  WA SERVICE        │   │  WEB             │
│   (Bun + Hono)   │    │  (Bun + Hono)      │   │  (Next.js)       │
└────────┬─────────┘    └─────────┬──────────┘   └──────────────────┘
         │                        │
         │                        ▼
         │              ┌────────────────────┐
         │              │  AGENT SERVICE     │
         │              │  Claude Sonnet 4.6 │
         │              └─────────┬──────────┘
         │                        │
         ▼                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  CORE LIBRARIES                                      │
│  @comadre/anchor-client · @comadre/db · @comadre/cache               │
│  @comadre/types · @comadre/solana · @comadre/agent-tools             │
└─────────────────────────────────────────────────────────────────────┘
         │              │              │
         ▼              ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌────────────────┐
│  Postgres    │ │  Redis       │ │  Solana        │
│  (Supabase)  │ │  Upstash     │ │  + Helius      │
└──────────────┘ └──────────────┘ └────────┬───────┘
                                           │ webhook
                                           ▼
                                ┌──────────────────┐
                                │  INDEXER SERVICE │
                                └──────────────────┘
```

## Servicios

| Servicio | Puerto | Responsabilidad |
|---|---|---|
| `api` | 3001 | Public REST API. Auth via Privy JWT. Build unsigned txs. |
| `whatsapp` | 3002 | Meta webhook + outbound. 24h window state. |
| `agent` | 3003 | Claude tool-use loop. NUNCA firma tx. |
| `indexer` | 3004 | Helius webhook → parse logs Anchor → upsert Postgres. |
| `cron` | — | Jobs programados (payoutCrank, disputeResolveCrank, reminders). |
| `web` | 3000 | Landing + admin dashboard. |
| `mobile` | — | Expo dev server. |

## Wallets controladas por backend

| Wallet | Uso |
|---|---|
| `fee_payer` | Paga rents + tx fees |
| `crank_authority` | Llama instructions sin riesgo financiero (payout, complete_tanda) |
| `kyc_oracle` | Firma `update_kyc_tier` post Sumsub webhook |
| `admin` | `init_config`, `pause`. Multisig Squads en mainnet. |

## Auth flow

1. Cliente → Privy SDK → `accessToken` (JWT firmado por Privy).
2. Cliente → API con `Authorization: Bearer <token>`.
3. API valida con `@privy-io/server-auth.verifyAuthToken(token)`.
4. Claims contienen: `userId`, `walletAddress` (Solana), linkedAccounts.
5. Para WhatsApp: sin JWT user. WA service inyecta JWT interno HMAC-firmado.

## Tx signing flow (caso default)

```
1. POST /api/v1/tandas/:id/contribute  (body: { amount }, header: X-Idempotency-Key)
2. API arma instruction Anchor → transaction con fee_payer firmado
3. API → cliente: { unsignedTx: "base64..." }
4. Cliente deserializa, firma con Privy o Seed Vault, broadcast vía Helius
5. POST /api/v1/tandas/:id/contribute/confirm  { signature }
6. API espera 1 confirmación, marca DB como pendiente-onchain
7. Indexer (vía webhook) confirma → DB actualizada con tx_signature
```

## Observabilidad

| Área | Tool |
|---|---|
| Logs | Pino → Better Stack |
| Errors | Sentry |
| Métricas | Prometheus + Grafana (Railway addon) |
| Tx tracing | Helius dashboard |
| Uptime | Better Stack monitor |

Convención: todo log lleva `req_id`, `user_id`, y `tx_signature` cuando aplique.
