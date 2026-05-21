# Architecture

## Stack

| Capa | Tech | Versión |
|---|---|---|
| Smart contracts | Solidity + Foundry | 0.8.28 / Forge 1.5+ |
| Chain | Monad (EVM-compatible L1) | testnet en dev; mainnet pendiente del launch |
| Account abstraction | ZeroDev Kernel v3.1 (ERC-4337) | — |
| Bundler | Pimlico | — |
| Backend runtime | Bun | 1.2+ |
| Web framework | Hono | 4.x |
| Lenguaje backend | TypeScript | 5.7+ strict |
| ORM | Drizzle | 0.36+ |
| DB | Postgres (Supabase) | 15 |
| Cache/queue | Redis (Upstash REST) | — |
| Web | Next.js | 15 (App Router) |
| User wallet | Privy embedded EVM wallet | 1.32.5+ |
| Session key custody | Turnkey HSM (sub-org por usuario) | `@turnkey/sdk-server` 6.x |
| KYC | Sumsub REST API (level `id-and-liveness`) | backend-hosted via `sumsubClient.ts` |
| WhatsApp | Twilio (sandbox `+14155238886`) + Twilio Verify (OTP) | — |
| Agent LLM | Kimi K2 via Moonshot o Groq | `kimi-k2.6` / `moonshotai/kimi-k2-instruct` |
| Yield (Guardadito) | Neverland (Aave V3 fork en Monad mainnet) | APY ~13% en USDC; fee 20% sobre yield solamente |

## Topología

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CLIENTES                                    │
│         🌐 Web (Next.js, Privy embedded wallet)  💬 WhatsApp        │
└────────────────┬────────────────────────────────────┬───────────────┘
                 │                                    │ Twilio webhook
                 ▼                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     EDGE — Cloudflare (prod) / ngrok (dev)           │
└────────┬─────────────────────────┬────────────────┬─────────────────┘
         │                         │                │
         ▼                         ▼                ▼
┌──────────────────┐    ┌────────────────────┐   ┌──────────────────┐
│   apps/api       │    │  apps/whatsapp     │   │  apps/web        │
│   Hono :3001     │    │  Hono :3002        │   │  Next.js :3000   │
│   Auth: Privy JWT│    │  Auth: Twilio sig  │   │  (magic link UI)│
│   + HMAC interna │    │  + HMAC interna    │   │                  │
└────────┬─────────┘    └─────────┬──────────┘   └──────────────────┘
         │                        │
         │                        ▼
         │              ┌────────────────────┐
         │              │  apps/agent        │
         │              │  Hono :3003        │
         │              │  Kimi K2 tool-loop │
         │              └─────────┬──────────┘
         │                        │ HMAC interno
         ▼                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  CORE PACKAGES                                        │
│  @comadre/db · @comadre/cache · @comadre/types · @comadre/config     │
│  @comadre/agent-tools · @comadre/wallet-infra (Turnkey + Kernel)     │
└─────────────────────────────────────────────────────────────────────┘
         │              │              │
         ▼              ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌─────────────────────────┐
│  Postgres    │ │  Redis       │ │  Monad testnet          │
│  (Supabase)  │ │  (Upstash)   │ │  + Pimlico bundler      │
└──────────────┘ └──────────────┘ │  + Privy embedded EVM   │
                                  │  + Kernel v3.1 smart    │
                                  │    wallets              │
                                  │                          │
                                  │  Turnkey HSM ───────────┤
                                  │  (session keys per user)│
                                  └─────────────────────────┘
```

## Servicios

| Servicio | Puerto | Responsabilidad |
|---|---|---|
| `apps/api` | 3001 | REST API pública. Auth via Privy JWT. Build + relay de UserOps Monad. Llama a Turnkey para firmar con session keys. |
| `apps/whatsapp` | 3002 | Twilio webhook inbound + outbound REST. Verifica `X-Twilio-Signature`. Reenvía al agent service. |
| `apps/agent` | 3003 | Kimi K2 tool-use loop (max 5 iteraciones). Historial en Redis. NUNCA firma tx. |
| `apps/cron` | — | `disputeResolveCrank`, `reminderJob`, `kycRefreshJob`. |
| `apps/web` | 3000 | Landing + magic-link onboarding UI (Next.js, Privy gate). |

## Custodia de claves (modelo de wallets)

| Capa | Custodio | Uso |
|---|---|---|
| **User wallet** (Privy embedded EVM) | Privy enclaves | EOA del usuario. Firma una sola vez en onboarding (SMS OTP) para autorizar la session key. La key nunca toca el backend. |
| **Kernel v3.1 smart wallet** | Owned por user wallet on-chain | Cuenta principal del usuario. Holds USDC. Pays gas en MON. Tiene session key instalada con permission plugin. |
| **Session key del agente** | Turnkey HSM (sub-org por usuario) | Firma UserOps en nombre del usuario. Scoped a USDC `transfer`/`approve` + funciones Comadre.sol. Per-call cap $50, validity 30d. |
| **KYC oracle key** | Turnkey HSM (org master) | Llama `updateKycTier` en Comadre.sol después de webhook Sumsub `GREEN`. |
| **Admin key** | Multisig (planeado mainnet) | Pause/unpause + role rotation. Phase 1: dev key en `.env`. |

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

## Tx signing flow (Monad + Turnkey)

### Onboarding (1-time, user-visible)

```
1. User manda primer mensaje WhatsApp → agent llama iniciar_cuenta_segura
2. apps/api /onboarding/monad/start envía magic link por Twilio SMS
3. User abre link → browser carga Privy SDK con OTP SMS
4. User pone OTP UNA VEZ en la UI de Privy → embedded EVM wallet creado
5. apps/api /onboarding/monad/finalize:
   - Verifica Privy JWT
   - Llama a Turnkey: provisionUserAgent → crea sub-org + agent wallet
   - Devuelve agent_wallet_address al browser
6. Browser instala permission plugin en Kernel smart wallet
   (firma con Privy owner, autoriza al agent_wallet a operar)
7. apps/api /onboarding/monad/install-session-key persiste:
   { turnkey_sub_org_id, turnkey_wallet_id, serialized_permission }
```

### Transfer (invisible para el user, post-onboarding)

```
1. User: "manda 10 USDC al +52..." vía WhatsApp
2. Agent llama enviar_plata tool → POST /api/v1/transfers-monad
3. apps/api:
   - Decodifica calldata USDC transfer(to, amount)
   - Verifica to ∈ allowedRecipients (COM-004)
   - Verifica amount <= per_call_cap
   - Llama signMonadTransfer({ subOrgId, walletId, ... })
4. monadSessionSigner.ts:
   - Recupera (subOrgId, walletId, serialized_permission) de DB
   - Llama Turnkey.signEvmPayload → firma del UserOp digest
   - Construye Kernel client con esa firma
   - Pimlico bundler submite el UserOp
5. UserOp ejecuta en Kernel del user → USDC.transfer(to, amount)
6. apps/api persiste { status: confirmed, tx_hash }
```

**El usuario NUNCA ve un popup de firma post-onboarding.** La session key vive en Turnkey HSM, el backend pide firmas por referencia (`subOrgId + walletId + payload`), y Turnkey enforza policies a nivel HSM.

### Guardadito — depósito/retiro (paralelo a transfers)

```
1. User: "guardá 50 USDC" vía WhatsApp
2. Agent llama preparar_guardadito → POST /api/v1/savings/deposit
3. apps/api:
   - Verifica amount >= 1 USDC (mínimo), sin máximo
   - Construye UserOp atómico con 2 calls:
     (a) USDC.approve(neverlandPool, amount)
     (b) NeverlandPool.supply(usdc, amount, userKernelWallet, 0)
   - Llama signMonadTransfer con ese UserOp
4. monadSessionSigner.ts:
   - Session key tiene políticas adicionales: USDC.approve(pool,*), Pool.supply, Pool.withdraw, USDC.transfer(feeWallet,*)
   - Turnkey firma el UserOp digest
   - Pimlico bundler submite el UserOp
5. UserOp ejecuta en Kernel del user → fondos van User Kernel wallet → Neverland Pool
   Comadre NUNCA toca los fondos.
6. Al retirar:
   - Adapter calcula yield = underlyingValue − principal (proporcional)
   - Fee = yield × 20% → USDC.transfer(COMADRE_FEE_WALLET, fee) en el mismo UserOp
   - Remanente de USDC va al Kernel wallet del usuario
```

## Modelo de yield (Guardadito)

### Flujo de fondos

```
Usuario              Kernel wallet (ERC-4337)            Neverland Pool (Aave V3)
  │                        │                                      │
  │── "guardá 50 USDC" ──► │                                      │
  │                        │── approve(pool, 50 USDC) ──────────► │
  │                        │── supply(usdc, 50, wallet, 0) ──────► │ recibe nUSDC
  │◄─ confirmación ─────── │◄───────────── nUSDC emitido ─────────│
  │                        │                                      │
  │── "retirá todo" ──────► │                                      │
  │                        │── withdraw(amount) ─────────────────► │ burn nUSDC
  │                        │◄─────── USDC (principal + yield) ────│
  │                        │── transfer(feeWallet, yield×20%) ───► COMADRE_FEE_WALLET
  │◄─ USDC neto ─────────── │
```

### Modelo de fee

| Concepto | Valor |
|---|---|
| Fee de Comadre | 20% sobre yield solamente (`COMADRE_YIELD_FEE_BPS = 2000`) |
| Base mínima de cálculo | El fee se aplica sobre `underlyingValue − principalNet` en el momento del retiro |
| Fee sobre principal | NUNCA — si no hay yield, no hay fee |
| Monto mínimo depósito | $1 USDC (1_000_000 micro-USDC) |
| Monto máximo depósito | Sin límite |
| Recompensas MON + DUST | 100% a `COMADRE_FEE_WALLET` (sustentabilidad operativa) |

### Contratos Neverland verificados (Monad mainnet)

| Contrato | Address |
|---|---|
| Pool (Proxy) | `0x80F00661b13CC5F6ccd3885bE7b4C9c67545D585` |
| USDC | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` |
| nUSDC | `0x38648958836eA88b368b4ac23b86Ad44B0fe7508` |
| UiPoolDataProviderV3 | `0x0733e79171dd5A5E8aF41E387c6299bCfE6a7e55` |
| DustRewardsController | `0x57ea245cCbFAb074baBb9d01d1F0c60525E52cec` |

### Decisiones de arquitectura

- **Sin contratos propios de yield**: Comadre llama directamente los contratos auditados de Neverland. Sin superficie de ataque adicional.
- **UserOp único**: approve + supply (o withdraw + fee transfer) se ejecutan atómicamente en un solo UserOp Kernel. No hay estado intermedio explotable.
- **Session key con scope mínimo**: las 4 políticas adicionales en el Kernel permission plugin son exactamente `USDC.approve(pool,*)`, `Pool.supply`, `Pool.withdraw`, `USDC.transfer(feeWallet,*)`. Sin permiso de sweep general.

---

## Observabilidad

| Área | Tool | Estado |
|---|---|---|
| Logs | Pino → BetterStack (opcional) | Pino activo en todos los servicios; BetterStack pendiente de wiring |
| Errors | Sentry (`@sentry/bun`) | Inicializado en api, agent y whatsapp. Gated por `SENTRY_DSN` (opcional). Trace sampling: 10% prod, 100% dev. |
| Tx tracing | Monadscan + Pimlico dashboard | Activo |
| Uptime | BetterStack monitor (opcional) | Pendiente |

Convención: todo log lleva `req_id` (del middleware Hono), `user_id` o `from` (WA), y `tx_signature` cuando aplique.

## Consideraciones de seguridad

- `TWILIO_AUTH_TOKEN` se usa **únicamente** para verificar `X-Twilio-Signature` (webhook inbound). Outbound usa `TWILIO_API_KEY_SID` + `TWILIO_API_KEY_SECRET` (scoped keys).
- `INTERNAL_HMAC_SECRET` protege **todas** las llamadas service-to-service: `apps/whatsapp → apps/agent /process`, `apps/agent → apps/api` (via `@comadre/agent-tools`), y `apps/api → apps/whatsapp /reply`. Formato: HMAC-SHA256 de `"METHOD\nPATH\nTIMESTAMP\nBODY"` con replay protection (ventana de 5 minutos, timing-safe compare). Generar con `openssl rand -hex 32`.
- **CORS**: `apps/api` restringe orígenes a `comadre.lat` en producción (`*` en dev). Headers custom (`X-Idempotency-Key`, `X-Internal-Signature`, `X-Internal-Timestamp`, `X-Dev-Wallet`, `X-Dev-User-Id`) están whitelisted.
- **Rate limiting**: 4 limiters en `@comadre/cache` vía Upstash sliding window:
  - `webhookRateLimit` — 60 req/min por phone (apps/whatsapp webhook)
  - `agentToolRateLimit` — 30 tool calls/hora por conversación (apps/agent)
  - `apiUserRateLimit` — 100 req/min por usuario (apps/api)
  - `phoneLookupRateLimit` — 20 req/min por usuario en `GET /api/v1/transfers/lookup` (defensa oracle — CRIT-3)
  - Todos fail-open si Redis no está disponible (log warn, no bloquean tráfico).
- **Sentry**: inicializado en api, agent y whatsapp. Solo se activa si `SENTRY_DSN` está configurado (opcional). Trace sampling: 10% en producción, 100% en dev.
- Todas las SKs de wallets viven en `.env` durante hackathon. En producción → Doppler/Infisical.
- El programa Anchor tiene un guard deployer-only en `init_config` para prevenir front-run.
- **Guardadito (Neverland)**: Comadre **nunca custodia fondos de yield**. El flujo es siempre User Kernel wallet ↔ Neverland Pool directamente. El fee se cobra en el mismo UserOp del retiro — no hay paso separado en el que los fondos del usuario pasen por una wallet de Comadre. Si `COMADRE_FEE_WALLET` no está configurado, el endpoint de retiro falla con 503 antes de ejecutar nada on-chain.

### Controles de autorización por endpoint (audit sprint A)

| Endpoint | Control añadido |
|---|---|
| `GET /api/v1/tandas/:id` | Membership check: no-miembros reciben vista reducida (sin array `members`). |
| `POST /api/v1/tandas` | `usdc_mint` removido del input schema; el servidor usa `process.env.USDC_MINT` exclusivamente. |
| `GET /api/v1/transfers/lookup` | Respuesta reducida a `{ registered, walletPreview }`. Campos `wallet`, `kycTier` y `phoneHash` eliminados de la respuesta pública. Rate limit dedicado 20 req/min. |
| `POST /api/v1/users/:wallet/confirm` | Enforcement de que el wallet del path coincide con el usuario autenticado (previene account squatting). |
| `GET /api/v1/disputes/:id` | Membership check: no-miembros ven solo conteo agregado de votos; sin wallets de votantes, opener ni razón. |
| `POST /api/v1/kyc/session` | Reutiliza sesión existente solo si su estado es `init`, `pending` o `approved`. Sesiones `rejected` fuerzan creación de un nuevo applicant. |

### Protección de PII en el agente (audit sprint A)

- **System prompt**: 8 reglas de prioridad máxima para PII (ver `SECURITY.md`).
- **Redacción de respuestas de tools**: helper `redactSensitiveFields()` en `@comadre/agent-tools`. Wallets enmascarados a `...XXXX`, teléfonos a `+52...XX`. Campos `privyUserId`, `applicantId`, `phone_hash`, `secret_key_b58` eliminados de todo dato que llega al LLM.
- **`iniciar_cuenta_segura`**: el parámetro `telefono` fue removido del toolset LLM-controlado; el teléfono es inyectado server-side desde `context.senderPhone`.

### Smart contracts (audit sprint A)

**Solidity Comadre.sol** (`packages/monad-contracts`):
- Disputes vinculadas al `tandaKey` del origen; cross-tanda voting bloqueado con `DisputeTandaMismatch` (CRIT-02).
- Quorum mínimo `ceil(memberTarget/2)` para resolver disputa; sin quorum → estado `Expired` y tanda vuelve a `Active` (CRIT-03).
- Todos los setters de roles verifican `address(0)` (HIGH-01). Constructor valida todas las direcciones no nulas (HIGH-02).
- `resolveDispute` refresca `nextPayoutTs` al retornar a `Active` (HIGH-05).
- `initUserProfile` exige `msg.sender == wallet` (HIGH-06).
- `payout` usa schedule rolling (MED-05). `MAX_FEE_BPS` reducido a 300 (3%) (MED-08). `createTanda` exige `frequency <= MAX_FREQUENCY = 90 days` (LOW-05).

---

## Toolset wallet-state-aware del agente

`apps/agent/src/agentLoop.ts` llama a `toolsForWalletState(userWallet)` antes de cada invocación al LLM. Si el user ya tiene fila en la DB, `iniciar_cuenta_segura` es **excluido** del toolset. El system prompt tiene una "REGLA ABSOLUTA #1" en el tope que le dice al LLM: "si `iniciar_cuenta_segura` no está en tu toolset, el user ya está registrado — no menciones crear billetera".

## Topología de deployment

```
Internet
   │  HTTPS (Let's Encrypt)
   ▼
nginx (:443)
   │
   ├─► :3002  comadre-whatsapp  (recibe webhooks Twilio)
   │              │ HMAC interno
   │              └─► :3003  comadre-agent  (Kimi K2 tool loop)
   │                        │ HMAC interno
   │                        └─► :3001  comadre-api
   │                                  │
   │                          ┌───────┴──────────┬──────────────────┐
   │                          ▼                  ▼                  ▼
   │                       Postgres        Upstash Redis      Turnkey API
   │                       (Supabase)      (cloud REST)       (HSM signing)
   │
   ├─► :3000  comadre-web (Next.js — magic link onboarding)
   │              │
   │              └─► Privy SDK (browser OTP, embedded EVM wallet)
   │
   └─► Monad testnet (RPC + Pimlico bundler)
```

VPS: Azure Ubuntu 22.04. Los servicios son units `systemd --user`. TLS via `certbot` (snap).
