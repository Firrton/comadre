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
| KYC | Sumsub | REST API integrado en `apps/api` (backend-hosted flow via `sumsubClient.ts`). WebSDK 2 móvil es Fase 2. |
| WhatsApp | Twilio (sandbox `+14155238886`) | — |
| Agent LLM | Kimi K2 via Moonshot o Groq | `kimi-k2.6` (Moonshot) / `moonshotai/kimi-k2-instruct` (Groq) |
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
6. apps/whatsapp → apps/agent  X-Internal-Signature: HMAC-SHA256("POST\n/process\nTIMESTAMP\nBODY", INTERNAL_HMAC_SECRET) + replay protection (5 min window)
7. apps/agent → apps/api  X-Internal-Signature: HMAC-SHA256("METHOD\nPATH\nTIMESTAMP\nBODY", INTERNAL_HMAC_SECRET)

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

| Área | Tool | Estado |
|---|---|---|
| Logs | Pino → BetterStack (opcional) | Pino activo en todos los servicios; BetterStack pendiente de wiring |
| Errors | Sentry (`@sentry/bun`) | Inicializado en api, agent y whatsapp. Gated por `SENTRY_DSN` (opcional). Trace sampling: 10% prod, 100% dev. |
| Tx tracing | Helius dashboard | Activo |
| Uptime | BetterStack monitor (opcional) | Pendiente |

Convención: todo log lleva `req_id` (del middleware Hono), `user_id` o `from` (WA), y `tx_signature` cuando aplique.

## Consideraciones de seguridad

- `TWILIO_AUTH_TOKEN` se usa **únicamente** para verificar `X-Twilio-Signature` (webhook inbound). Outbound usa `TWILIO_API_KEY_SID` + `TWILIO_API_KEY_SECRET` (scoped keys).
- `INTERNAL_HMAC_SECRET` protege **todas** las llamadas service-to-service: `apps/whatsapp → apps/agent /process`, `apps/agent → apps/api` (via `@comadre/agent-tools`), y `apps/api → apps/whatsapp /reply`. Formato: HMAC-SHA256 de `"METHOD\nPATH\nTIMESTAMP\nBODY"` con replay protection (ventana de 5 minutos, timing-safe compare). Generar con `openssl rand -hex 32`.
- **CORS**: `apps/api` restringe orígenes a `comadre.lat` en producción (`*` en dev). Headers custom (`X-Idempotency-Key`, `X-Internal-Signature`, `X-Internal-Timestamp`, `X-Dev-Wallet`, `X-Dev-User-Id`) están whitelisted.
- **Rate limiting**: 3 limiters en `@comadre/cache` vía Upstash sliding window:
  - `webhookRateLimit` — 60 req/min por phone (apps/whatsapp webhook)
  - `agentToolRateLimit` — 30 tool calls/hora por conversación (apps/agent)
  - `apiUserRateLimit` — 100 req/min por usuario (apps/api)
  - Todos fail-open si Redis no está disponible (log warn, no bloquean tráfico).
- **Sentry**: inicializado en api, agent y whatsapp. Solo se activa si `SENTRY_DSN` está configurado (opcional). Trace sampling: 10% en producción, 100% en dev.
- Todas las SKs de wallets viven en `.env` durante hackathon. En producción → Doppler/Infisical.
- El programa Anchor tiene un guard deployer-only en `init_config` para prevenir front-run.

---

## Modelo de signing (actualizado — custodial backend)

> **NOTA**: Este modelo reemplaza el modelo Privy-custodial documentado más arriba en este archivo. La sección anterior se mantiene por contexto histórico.

### Auth-by-channel (custodial)

La autenticación deriva del número de teléfono verificado en cada webhook de Twilio. El backend valida el header `X-Twilio-Signature` en cada request; un mensaje que falla esta verificación se descarta antes de llegar a lógica de negocio. **La posesión del número es el límite de autenticación.**

El manejo de wallets es 100% server-side:

1. Al primer consentimiento ("sí"), `apps/api/src/lib/onboarding.ts` llama a `Keypair.generate()`.
2. La public key se vuelve la dirección del wallet del user (guardada en `users.wallet`).
3. La secret key (base58) se guarda en `user_keypairs.secret_key_b58`.
4. Toda instrucción posterior se firma vía `signWithUserKeypair(walletAddress)`, que carga el secret de la DB, reconstruye el `Keypair` y firma la transacción.

**¿Por qué NO Privy?** El diseño original usaba embedded wallets de Privy. La API server-side de Privy para firma requiere authorization keys que no se pudieron provisionar en el plazo del hackathon. Privy fue removido; su complejidad de signing se reemplaza por custodia directa de keys. **No hay SDK de Privy en el codebase actual.**

### Agente con toolset wallet-state-aware

`apps/agent/src/agentLoop.ts` llama a `toolsForWalletState(userWallet)` antes de cada invocación al LLM. Si el user ya tiene fila en la DB, `iniciar_onboarding` es **excluido** del toolset. El system prompt tiene una "REGLA ABSOLUTA #1" en el tope que le dice al LLM: "si `iniciar_onboarding` no está en tu toolset, el user ya está registrado — no menciones crear billetera".

### Topología de deployment

```
Internet
   │  HTTPS (Let's Encrypt vía sslip.io)
   ▼
nginx (:443) ─── 158-23-57-124.sslip.io
   │
   ├─► :3002  comadre-whatsapp  (recibe webhooks Twilio)
   │              │
   │              └─► comadre-agent  (LLM tool loop)
   │                        │
   │                        └─► comadre-api  (REST + Anchor ix builder)
   │                                  │
   │                          ┌───────┴──────────┐
   │                        Postgres           Upstash Redis
   │                       (nativo VPS)        (cloud REST)
   │
   └─► Solana Devnet (RPC vía Helius)
```

VPS: Azure Ubuntu 22.04. Los 3 servicios son units `systemd --user`. TLS via `certbot` (snap).
