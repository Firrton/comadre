# Architecture

## Stack

| Capa | Tech | Versión |
|---|---|---|
| Smart contracts | Rust + Anchor | 0.31 |
| Backend runtime | Bun | 1.2+ |
| Web framework | Hono | 4.x |
| Lenguaje backend | TypeScript | 5.7+ strict |
| ORM | Drizzle | 0.36+ |
| DB | Postgres (Supabase) | 15 |
| Cache/queue | Redis (Upstash REST) | — |
| Mobile | React Native + Expo | SDK 52 |
| Web | Next.js | 15 (App Router) |
| Auth | Privy server-auth | 1.32.5+ |
| KYC | Sumsub | WebSDK 2 (Fase 2) |
| WhatsApp | Twilio (sandbox `+14155238886`) | — |
| Agent LLM | Kimi K2 via Moonshot o Groq | `kimi-k2-0905-preview` |
| Voice (Fase 2) | ElevenLabs Conv AI | — |
| RPC Solana | Helius | devnet/mainnet |

## Topología

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CLIENTES                                    │
│  📱 Expo (RN + Solana Mobile)  🌐 Web (Next.js)  💬 WhatsApp/Twilio │
└────────┬────────────────┬────────────────────────┬──────────────────┘
         │                │                        │
         ▼                ▼                        ▼ Twilio webhook
┌─────────────────────────────────────────────────────────────────────┐
│                     EDGE — Cloudflare (prod) / ngrok (dev)           │
└────────┬─────────────────────────┬────────────────┬─────────────────┘
         │                         │                │
         ▼                         ▼                ▼
┌──────────────────┐    ┌────────────────────┐   ┌──────────────────┐
│   apps/api       │    │  apps/whatsapp     │   │  apps/web        │
│   Hono :3001     │    │  Hono :3002        │   │  Next.js :3000   │
│   Auth: Privy JWT│    │  Auth: Twilio sig  │   │                  │
│   + HMAC interna │    │  + HMAC interna    │   │                  │
└────────┬─────────┘    └─────────┬──────────┘   └──────────────────┘
         │                        │
         │                        ▼
         │              ┌────────────────────┐
         │              │  apps/agent        │
         │              │  Hono :3003        │
         │              │  Kimi K2 tool-loop │
         │              └─────────┬──────────┘
         │                        │ llama API service
         ▼                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  CORE PACKAGES                                        │
│  @comadre/anchor-client · @comadre/db · @comadre/cache               │
│  @comadre/types · @comadre/solana · @comadre/agent-tools             │
└─────────────────────────────────────────────────────────────────────┘
         │              │              │
         ▼              ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌────────────────┐
│  Postgres    │ │  Redis       │ │  Solana        │
│  (Supabase)  │ │  (Upstash)   │ │  devnet        │
└──────────────┘ └──────────────┘ └────────┬───────┘
                                           │ Helius enhanced webhooks
                                           ▼
                                ┌──────────────────┐
                                │  apps/indexer    │
                                │  Hono :3004      │
                                └──────────────────┘
```

## Servicios

| Servicio | Puerto | Responsabilidad |
|---|---|---|
| `apps/api` | 3001 | REST API pública. Auth via Privy JWT. Construye unsigned txs, firma con Privy server SDK, broadcast. |
| `apps/whatsapp` | 3002 | Twilio webhook inbound + outbound REST. Verifica `X-Twilio-Signature`. Reenvía al agent service. |
| `apps/agent` | 3003 | Kimi K2 tool-use loop (max 5 iteraciones). Historial en Redis. NUNCA firma tx. |
| `apps/indexer` | 3004 | Helius enhanced webhook → Anchor EventParser → upsert Postgres idempotente. |
| `apps/cron` | — | `payoutCrank` (5 min), `disputeResolveCrank` (1 h), `reminderJob` (9 am diario). |
| `apps/web` | 3000 | Landing + admin dashboard (Next.js, Privy gate). |

## Wallets controladas por backend

| Wallet | Variable de entorno | Uso |
|---|---|---|
| `fee_payer` | `FEE_PAYER_SK` | Paga rents + tx fees. Debe tener SOL. |
| `crank_authority` | `CRANK_AUTHORITY_SK` | Firma `payout`, `complete_tanda`, `resolve_dispute`. Sin riesgo financiero directo. |
| `kyc_oracle` | `KYC_ORACLE_SK` | Firma `update_kyc_tier` post-webhook Sumsub. |
| `admin` | `ADMIN_SK` | `init_config`, `pause`/`unpause`. Multisig Squads en mainnet. |

## Auth model

```
1. User → Privy SDK (OTP phone / email) → accessToken (JWT firmado por Privy)
2. User → apps/api  Authorization: Bearer <privy-jwt>
3. apps/api → @privy-io/server-auth verifyAuthToken(token, privyVerificationKey)
4. Claims: { userId, walletAddress (Solana embedded), linkedAccounts }

WhatsApp path (sin JWT de usuario):
5. Twilio → apps/whatsapp  X-Twilio-Signature (HMAC-SHA1 sobre TWILIO_AUTH_TOKEN)
6. apps/whatsapp → apps/agent  (sin auth adicional, red interna)
7. apps/agent → apps/api  X-Internal-Auth: HMAC-SHA256(body, INTERNAL_HMAC_SECRET)

Dev bypass:
   X-Dev-Wallet: <address>  →  omite Privy verify, solo en NODE_ENV !== production
```

## Tx signing flow (server-side via Privy)

```
1. POST /api/v1/transfers  (body, X-Idempotency-Key)
2. API construye SPL Token Transfer instruction + buildUnsignedTx(fee_payer partial-sign)
3. Persiste row (status=pending), stash unsignedTxBase64 en Redis (TTL 5 min)
4. Devuelve al agent: { transferId, unsignedTxBase64 }

5. Agent confirma con usuario y llama POST /api/v1/transfers/:id/confirm
6. API fetches unsignedTxBase64 de Redis
7. API → Privy walletApi.solana.signTransaction({ walletId, transaction })
   — el walletId viene de los linkedAccounts del Privy JWT
8. Privy devuelve { signedTransaction }
9. API → Solana submitWithRetry(signedTx)
10. API persiste { status: confirmed, tx_signature }
```

**Nota MVP**: el signing es completamente server-side (custodial). El usuario nunca toca la llave privada — Privy custodia el embedded wallet y firma bajo instrucción del servidor autenticado.

## Observabilidad

| Área | Tool |
|---|---|
| Logs | Pino → BetterStack (opcional) |
| Errors | Sentry (opcional, post-MVP) |
| Tx tracing | Helius dashboard |
| Uptime | BetterStack monitor (opcional) |

Convención: todo log lleva `req_id` (del middleware Hono), `user_id` o `from` (WA), y `tx_signature` cuando aplique.

## Consideraciones de seguridad

- `TWILIO_AUTH_TOKEN` se usa **únicamente** para verificar `X-Twilio-Signature` (webhook inbound). Outbound usa `TWILIO_API_KEY_SID` + `TWILIO_API_KEY_SECRET` (scoped keys).
- `INTERNAL_HMAC_SECRET` protege las llamadas service-to-service (`/reply`, `/process`). Generar con `openssl rand -hex 32`.
- Todas las SKs de wallets viven en `.env` durante hackathon. En producción → Doppler/Infisical.
- El programa Anchor tiene un guard deployer-only en `init_config` para prevenir front-run.
