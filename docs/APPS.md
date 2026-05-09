# Comadre — Apps reference

> Referencia técnica de los 5 servicios backend. Cada uno corre en su propio proceso Bun con Hono (excepto `apps/cron`, que usa node-cron + Hono solo para `/health`). El monorepo se orquesta con Turbo: `bun run dev` desde la raíz levanta todos los servicios en modo hot-reload.

## Service map

| App | Puerto | Responsabilidad principal | Stack clave |
|---|---|---|---|
| `apps/api` | 3001 | REST API público — Privy JWT auth, builds unsigned txs, persiste off-chain state | Hono + Drizzle + Privy SDK + Solana web3 |
| `apps/whatsapp` | 3002 | Webhook entrada/salida Twilio; HMAC inter-service en `/reply` | Hono + Twilio SDK |
| `apps/agent` | 3003 | Tool-use loop con Moonshot Kimi K2; conversation state en Redis | Hono + OpenAI SDK → Moonshot/Groq baseURL |
| `apps/cron` | 3005 | Jobs scheduled (payout 5 min, dispute 1 h, reminder/kyc diarios) | node-cron + Hono `/health` |
| `apps/indexer` | 3004 | (esqueleto) Helius webhook + Anchor EventParser → upsert Postgres | Hono (TODO post-MVP) |

## TOC

- [apps/api](#appsapi)
- [apps/whatsapp](#appswhatsapp)
- [apps/agent](#appsagent)
- [apps/cron](#appscron)
- [apps/indexer](#appsindexer)

---

## apps/api

**Puerto**: 3001  
**Source**: `apps/api/src/`  
**Entry**: `src/index.ts` — `Bun.serve({ port, fetch: app.fetch })` con graceful shutdown en SIGTERM/SIGINT (cierra pool de DB via `@comadre/db.closeDb`).  
**App**: `src/server.ts` — construye la instancia Hono, aplica middlewares y monta los routers.

### Middleware stack (orden de aplicación)

| # | Middleware | Archivo | Aplica a | Detalle |
|---|---|---|---|---|
| 1 | `loggerMiddleware` | `middlewares/logger.ts` | `*` | Pino logger; inyecta `req_id` (UUID v4) + child logger en el context Hono |
| 2 | `errorHandler` | `middlewares/errorHandler.ts` | `*` | Catch-all: `ZodError` → 400 con `issues`; resto → 500 con `req_id` |
| 3 | `rateLimitMiddleware` | `middlewares/rateLimit.ts` | `/api/*` excepto `/api/v1/onboarding/*` | `apiUserRateLimit` 100 req/min por `userId` (fallback a IP). Responde 429 + `Retry-After`. Transparente si Redis falla. |
| 4 | `authMiddleware` | `middlewares/auth.ts` | `/api/*` excepto `/api/v1/onboarding/*` | Verifica `Authorization: Bearer <jwt>` con Privy SDK (timeout 3 s). Sets `c.set("user", AuthUser)`. Dev bypass: `X-Dev-Wallet` + `X-Dev-User-Id` (solo `NODE_ENV !== production`). |
| 5 | `idempotencyMiddleware` | `middlewares/idempotency.ts` | POST en `/api/*` excepto `/api/v1/onboarding/*` | Requiere header `X-Idempotency-Key`. Cache key: `api:{userId}:{path}:{key}`. Cache hit → devuelve respuesta sin ejecutar handler. Redis failures son toleradas (log + pass-through). |

**Nota sobre skip de autenticación**: `/health`, `/webhooks/*` y `/api/v1/onboarding/*` son públicos. `webhooks/*` tiene su propio auth por HMAC/firma de proveedor.

### Routers

| Mount | Método | Path | Estado | Descripción |
|---|---|---|---|---|
| — | GET | `/health` | prod | Liveness check, no auth |
| `/webhooks` | POST | `/webhooks/sumsub` | parcial | Verifica `X-Payload-Digest` HMAC-SHA256 si `SUMSUB_WEBHOOK_SECRET` está seteado. Actualiza `kyc_sessions.status` en `applicantReviewed`. |
| `/webhooks` | POST | `/webhooks/privy` | stub | Recibe eventos de wallet linking. Loguea y responde 200. |
| `/webhooks` | POST | `/webhooks/helius` | log-only | Verifica `Authorization` header si `HELIUS_WEBHOOK_SECRET` está seteado. Loguea eventos; `apps/indexer` es el authoritative consumer. |
| `/api/v1/onboarding` | POST | `/api/v1/onboarding/init` | prod | Sin auth (usuario no tiene JWT aún). Body `{ phone: E.164 }`. Llama `onboardPhone()` → Privy `importUser` + embedded Solana wallet + insert en `users`. Idempotente. |
| `/api/v1/users` | POST | `/api/v1/users/init` | stub | Build stub de `init_user_profile` ix. Requiere `CreateUserProfileInput`. |
| `/api/v1/users` | POST | `/api/v1/users/:wallet/confirm` | prod | Upsert de row en `users`. Recibe `{ signature }` (verificación on-chain pendiente). |
| `/api/v1/users` | GET | `/api/v1/users/me` | prod | Perfil del usuario autenticado desde Postgres. |
| `/api/v1/tandas` | POST | `/api/v1/tandas` | stub | Create tanda — build stub de `create_tanda` ix. Requiere `CreateTandaInput`. |
| `/api/v1/tandas` | GET | `/api/v1/tandas` | prod | Lista tandas del usuario (via `members` join). Paginado: `?limit&offset`. |
| `/api/v1/tandas` | GET | `/api/v1/tandas/:id` | prod | Tanda con array `members[]` ordenado por `turn_number`. |
| `/api/v1/tandas` | POST | `/api/v1/tandas/:id/join` | stub | Pre-flight: tanda en `forming` + hay lugar. Build stub `join_tanda`. |
| `/api/v1/tandas` | POST | `/api/v1/tandas/:id/start` | stub | Pre-flight: caller es creator + tanda `forming` + miembros completos. Build stub `start_tanda`. |
| `/api/v1/tandas` | POST | `/api/v1/tandas/:id/contribute` | stub | Pre-flight: tanda `active` + caller es member + no contribuyó este turno. Build stub `contribute`. |
| `/api/v1` (disputes) | POST | `/api/v1/tandas/:id/disputes` | stub | Abre disputa. Pre-flight: caller es member. Build stub `open_dispute`. |
| `/api/v1` (disputes) | POST | `/api/v1/disputes/:id/vote` | stub | Vota en disputa `open`. Pre-flight: caller es member del tanda + no votó antes. Build stub `vote_dispute`. |
| `/api/v1` (disputes) | GET | `/api/v1/disputes/:id` | prod | Detalle de disputa con tallies de votos. |
| `/api/v1/kyc` | POST | `/api/v1/kyc/session` | stub | Si `SUMSUB_APP_TOKEN` no está: devuelve stub token + inserta `kyc_sessions` row. Con token: devuelve 501 (integración pendiente). |
| `/api/v1` (ramps) | POST | `/api/v1/onramp/quote` | mock | Fiat → USDC quote con tasas hardcodeadas (USD/ARS/MXN/COP/BRL/CLP/PEN). Válido 5 min. |
| `/api/v1` (ramps) | POST | `/api/v1/offramp/quote` | mock | USDC → Fiat quote. Mismo motor mock. |
| `/api/v1/transfers` | GET | `/api/v1/transfers/lookup` | prod | Resuelve `?phone=+E164` → wallet. Usa `lookupByPhone()`. |
| `/api/v1/transfers` | POST | `/api/v1/transfers` | prod | Crea transferencia P2P USDC. Dos paths: **immediate** (destinatario registrado) builds SPL Transfer ix, firma fee_payer, stashea unsigned tx en Redis (TTL 5 min), devuelve `unsignedTxBase64`; **deferred** (no registrado) inserta row `awaiting_recipient` (TTL 7 d) + envía WA al destinatario vía `/reply` interno. |
| `/api/v1/transfers` | POST | `/api/v1/transfers/:id/confirm` | prod | Fetches unsigned tx de Redis, firma server-side con Privy embedded wallet del usuario, broadcast via `submitWithRetry`, persiste `tx_signature`. |
| `/api/v1/transfers` | POST | `/api/v1/transfers/:id/cancel` | prod | Cancela transferencia `pending` o `awaiting_recipient`. Limpia Redis. |

**Tx-build stubs**: todos los endpoints de build de tx devuelven `{ unsigned_tx, idempotency_key, plan }`. `plan` documenta la instrucción Anchor planeada. Se reemplaza cuando `@comadre/anchor-client` se conecta post-deploy del programa.

### Lib helpers

| Archivo | Función | Descripción |
|---|---|---|
| `lib/phoneLookup.ts` | `lookupByPhone(e164)` | Resolución phone → wallet. Orden: (1) DB por `phone_hash`, (2) Privy `getUserByPhoneNumber` fallback. Retorna `{ registered, wallet, kycTier, walletPreview }`. |
| `lib/kycLimits.ts` | `enforceKycLimit(tier, amount)` | Lee `kyc_limits[T0..T3]` del PDA `ProgramConfig` on-chain. Cache en proceso 60 s. Fallback hardcodeado si el PDA no existe: T0=$10, T1=$100, T2=$1000, T3=$10000 (micro-USDC). Lanza `KycLimitExceededError` si excede. |
| `lib/usdcTransfer.ts` | `buildUsdcTransferIxs(params)` | Construye instrucciones SPL Token Transfer. Si el ATA del destinatario no existe → prepende `createAssociatedTokenAccountInstruction` (payer = fee_payer). Incluye `usdcToMicro` / `microToUsdc` para conversión decimal ↔ bigint. |
| `lib/privySigner.ts` | `signWithPrivy(params)` | Wraps `privy.walletApi.solana.signTransaction({ walletId, transaction })`. El fee_payer firma primero (parcial); Privy agrega la firma del usuario. Requiere `@privy-io/server-auth >= 1.32.5`. |
| `lib/onboarding.ts` | `onboardPhone(phone)` | Privy `importUser` (o lookup si ya existe) + `createWallets` si no tiene Solana wallet. Inserta row en `users` (idempotente por wallet). Retorna `{ walletAddress, walletId, privyUserId, alreadyExisted }`. |
| `lib/phoneNormalize.ts` | `normalizePhoneE164` | E.164 con quirks MX/AR (eliminación de dígito redundante). |
| `lib/stubs.ts` | `makeTxStub(key, plan)` | Devuelve `UnsignedTransactionResponse` con `unsigned_tx` de 32 bytes cero (base64). Usado en todos los endpoints de tx-build que aún no tienen anchor-client real. |

### Env vars consumidas

| Variable | Requerida | Uso |
|---|---|---|
| `PORT` | no | Puerto del servidor (default: 3001) |
| `NODE_ENV` | no | `production` desactiva dev bypass de auth |
| `PRIVY_APP_ID` / `PRIVY_APP_SECRET` | sí | Verificación JWT + wallet API (auth, onboarding, signer) |
| `DATABASE_URL` | sí | Drizzle + Postgres (Supabase recomendado) |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | sí (prod) | Rate limiting, idempotency, stash de unsigned tx |
| `SOLANA_RPC_URL` / `SOLANA_CLUSTER` | sí | Conexión RPC para tx-build y on-chain reads |
| `COMADRE_PROGRAM_ID` | sí | Derive PDAs Anchor (kycLimits, onboarding) |
| `USDC_MINT` | sí | Mint address USDC (devnet vs mainnet) |
| `FEE_PAYER_SK` | sí | Keypair base58; firma transacciones como payer |
| `SUMSUB_APP_TOKEN` / `SUMSUB_WEBHOOK_SECRET` | no | KYC real (stub si ausentes) |
| `HELIUS_WEBHOOK_SECRET` | no | Auth header `/webhooks/helius` |
| `INTERNAL_HMAC_SECRET` | sí | HMAC SHA-256 para llamadas inter-servicio a `apps/whatsapp /reply` |
| `WA_URL` | sí | URL de `apps/whatsapp` (ej: `http://localhost:3002`) |
| `SKIP_REDIS` | no | `true` → bypasea Redis en tests |
| `LOG_LEVEL` | no | Pino log level (default: `info`) |

### Tests

3 suites en `src/lib/__tests__/`:

- `kycLimits.test.ts` — verifica límites T0–T3, cache hit, fallback hardcodeado cuando RPC falla.
- `privySigner.test.ts` — valida que `assertPrivySolanaCapability` detecta SDK shapes incorrectas.
- `usdcTransfer.test.ts` — cubre `usdcToMicro` / `microToUsdc` y construcción de ix (con y sin ATA creation).

Comando: `bun test --env-file .env.test` (requiere `ANTHROPIC_API_KEY=test-key` por runtime quirk).

---

## apps/whatsapp

**Puerto**: 3002  
**Source**: `apps/whatsapp/src/`  
**Entry**: `src/index.ts` — exporta `{ port, fetch: app.fetch }` para `Bun.serve`.

### Responsabilidad

Punto de entrada del canal WhatsApp. Recibe webhooks de Twilio, verifica la firma, reenvía al `apps/agent`, y envía la respuesta de vuelta. **No mantiene estado** — la conversación vive en Redis del agent.

### Endpoints

| Método | Path | Auth | Descripción |
|---|---|---|---|
| GET | `/health` | ninguna | Liveness check |
| POST | `/webhook` | Twilio HMAC | Webhook inbound de Twilio. Verifica `X-Twilio-Signature` con master `TWILIO_AUTH_TOKEN`. Extrae `From`, `Body`, `MessageSid` del form. Hace POST a `$AGENT_URL/process`. Envía reply vía `sendWhatsAppMessage`. Siempre responde `<Response/>` TwiML (Twilio exige 2xx con TwiML vacío). |
| POST | `/reply` | HMAC SHA-256 interno | Endpoint interno: recibe `{ to, body }` de otros servicios (API, cron). Auth via `X-Internal-Auth` = HMAC-SHA256(body, `INTERNAL_HMAC_SECRET`), timing-safe compare. Llama `sendWhatsAppMessage`. |

### Lib helpers

| Archivo | Descripción |
|---|---|
| `lib/twilioClient.ts` | Singleton `Twilio(API_KEY_SID, API_KEY_SECRET, { accountSid })`. Usa credenciales **escopadas** (API Key) para outbound. **Nota**: la verificación de firma de webhook usa el `TWILIO_AUTH_TOKEN` (master), no el API Key. |
| `lib/sendMessage.ts` | `sendWhatsAppMessage(to, body)` — `twilioClient.messages.create({ from, to, body })`. Solo válido dentro de la ventana de conversación de 24 h. |
| `lib/verifySignature.ts` | `verifyTwilioSignature({ authToken, signature, url, params })` — wraps `Twilio.validateRequest`. Requiere que `WA_URL` sea la URL exacta que Twilio usó para firmar (usar URL de ngrok en dev). |

### Flujo de un mensaje inbound

```
Twilio → POST /webhook
  ↓ verifyTwilioSignature (X-Twilio-Signature)
  ↓ fetch AGENT_URL/process { from, body, conversationKey }
  ↓ agent responde { reply }
  ↓ sendWhatsAppMessage(from, reply)
  ↓ return <Response/> 200
```

### Env vars consumidas

| Variable | Uso |
|---|---|
| `TWILIO_AUTH_TOKEN` | Verificación de firma de webhook inbound (master token) |
| `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET` | Outbound `messages.create` (scoped key) |
| `TWILIO_ACCOUNT_SID` | Requerido por el SDK para construir URLs de recursos |
| `TWILIO_WHATSAPP_FROM` | Número de origen (ej: `whatsapp:+14155238886`) |
| `WA_URL` | URL propia (usada para construir la URL de firma Twilio — ngrok en dev) |
| `AGENT_URL` | URL de `apps/agent` (ej: `http://localhost:3003`) |
| `INTERNAL_HMAC_SECRET` | HMAC para autenticar llamadas internas a `/reply` |

---

## apps/agent

**Puerto**: 3003  
**Source**: `apps/agent/src/`  
**Entry**: `src/index.ts` — exporta `{ port, fetch: app.fetch }`.

### Responsabilidad

Implementa el loop de tool-use de Kimi K2. Recibe un mensaje de WhatsApp (via `apps/whatsapp`), resuelve el usuario, carga historial de Redis, ejecuta el loop con hasta 5 iteraciones de tools, persiste el historial actualizado y devuelve el reply.

### Endpoints

| Método | Path | Descripción |
|---|---|---|
| GET | `/health` | Liveness check |
| POST | `/process` | Body: `{ from, body, conversationKey }`. Orquesta `resolveUser → loadHistory → runAgent → saveHistory`. Devuelve `{ reply }`. |

### Loop de tool-use (`src/agentLoop.ts`)

1. Construye el array de mensajes: `[system, ...history, userTurn]`.
2. Llama `llmClient.chat.completions.create` con `tools: ALL_TOOLS`, `tool_choice: "auto"`, `temperature: 1`, `max_tokens: 4000`.
3. Si la respuesta tiene `tool_calls`: ejecuta cada tool via `executeTool` de `@comadre/agent-tools`.
4. Agrega el resultado como mensaje `role: "tool"` y repite (máximo `MAX_TOOL_ITERATIONS = 5`).
5. Cuando no hay más tool calls → retorna `{ reply, newMessages }`.
6. Si se agotan las iteraciones → retorna mensaje de disculpa hardcodeado.

**Gate de wallet**: si `userWallet === null` (usuario no registrado) y el tool solicitado no está en `TOOLS_ALLOWED_WITHOUT_WALLET`, el loop responde con error `UNREGISTERED` al LLM sin ejecutar el tool. El único tool permitido sin wallet es `iniciar_onboarding`.

**Error UNREGISTERED** (literal devuelto al LLM):
```
UNREGISTERED: el usuario no tiene wallet todavía. Pide consentimiento explícito ANTES de llamar `iniciar_onboarding`.
```

### Lib helpers

| Archivo | Descripción |
|---|---|
| `lib/moonshotClient.ts` | Crea cliente `OpenAI` apuntando a Moonshot (`https://api.moonshot.ai/v1`) o Groq (`https://api.groq.com/openai/v1`) según `LLM_PROVIDER`. Ambos exponen el endpoint `/chat/completions` compatible con el SDK de OpenAI. |
| `lib/systemPrompt.ts` | `COMADRE_SYSTEM_PROMPT` — define el rol "tía cariñosa pero firme con la plata". Contiene las reglas de onboarding (3 escenarios de consentimiento), reglas de transferencias P2P, tandas y KYC upgrade. Máximo 2–3 oraciones por reply (WhatsApp UX). |
| `lib/conversationStore.ts` | `loadHistory` / `saveHistory` — Redis Upstash. Key: `agent:conv:{conversationKey}`. TTL: 24 h. Máximo historial guardado: 20 mensajes (trim al guardar). |
| `lib/userResolver.ts` | `resolveUserFromTwilio(twilioFrom)` — strip `whatsapp:` prefix → `normalizePhoneE164` → `hashPhone` → lookup en `users` por `phone_hash`. Retorna `{ wallet, phoneE164, phoneHash }` o `null` si no registrado. Solo DB, sin fallback a Privy. |
| `lib/phoneNormalize.ts` | `normalizePhoneE164` — strip del prefijo `whatsapp:` y normalización E.164 con quirks MX/AR. |

### Persona y reglas del sistema

El `COMADRE_SYSTEM_PROMPT` define 4 bloques de reglas:

| Bloque | Resumen |
|---|---|
| Tono | Español neutro LATAM, 2–3 oraciones, nunca mencionar que es AI |
| Onboarding (sin wallet) | 3 escenarios: saludo → pedir consentimiento con texto; acción → explicar necesidad + esperar "sí"; consentido → llamar `iniciar_onboarding` |
| Transferencias | Siempre mostrar confirmación (monto + número + `walletPreview`) antes de `confirmar_transfer` |
| KYC | Tiers T0 ($20/tx) → T1 ($50) → T2 ($500) → T3 (sin límite). `solicitar_kyc` devuelve link Sumsub. |

### Env vars consumidas

| Variable | Uso |
|---|---|
| `LLM_PROVIDER` | `moonshot` (default) o `groq` |
| `MOONSHOT_API_KEY` | Requerido si `LLM_PROVIDER=moonshot` |
| `GROQ_API_KEY` | Requerido si `LLM_PROVIDER=groq` |
| `KIMI_MODEL` | Nombre del modelo (ej: `kimi-k2-0905-preview`) |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Conversation store |
| `DATABASE_URL` | Lookup de usuarios (Drizzle) |

---

## apps/cron

**Puerto**: 3005  
**Source**: `apps/cron/src/`  
**Entry**: `src/server.ts` — levanta Hono `/health` + registra los 4 jobs vía `scheduleJob`. Graceful shutdown en SIGTERM/SIGINT: detiene tasks + cierra DB pool.

### Responsabilidad

Proceso de larga duración en Railway. Ejecuta jobs periódicos de mantenimiento del protocolo. No expone endpoints de negocio — solo `/health`.

### Scheduler (`lib/scheduler.ts`)

El wrapper de node-cron agrega:
- **In-flight guard**: si el run anterior de un job aún no terminó, skipea el tick actual (log warn).
- **Timeout**: 10 minutos por defecto. Si el job excede el timeout, loguea error y libera el lock.
- **Structured logging**: Pino con fields `job`, `schedule`, `durationMs`, `err` por evento.

### Jobs

| Job | Schedule | Query | Acción | Estado |
|---|---|---|---|---|
| `payoutCrank` | `*/5 * * * *` (cada 5 min) | `tandas` WHERE `state=active AND next_payout_ts <= now` | Para cada tanda due: emite stub `payout` tx-build + actualiza `lastSyncedAt` | stub tx |
| `disputeResolveCrank` | `0 * * * *` (cada hora) | `disputes` WHERE `state=open AND deadline_ts < now` | Calcula outcome (`votesContinue > votesCancel`), emite stub `resolve_dispute` tx-build | stub tx |
| `reminderJob` | `0 9 * * *` (09:00 UTC diario) | `tandas` active dentro de 24 h → `members` con `contributionsMade < currentTurn` → lookup `users.phoneHash` | Verifica ventana WA de 24 h (`isWithinWindow`). Envía template `tanda_recordatorio` (o `tanda_recordatorio_template` fuera de ventana) vía `sendTemplate` stub | stub WA |
| `kycRefreshJob` | `0 4 * * *` (04:00 UTC diario) | `kyc_sessions` WHERE `status=pending AND created_at < now-24h` | Marca sesiones como `on_hold`. Stub: en producción consultaría Sumsub `GET /resources/applicants/{id}/status` | stub Sumsub |

### Stubs pendientes de wiring real

| Stub | Archivo | Reemplazar con |
|---|---|---|
| `makeTxStub` | `lib/txStub.ts` | Llamadas reales a `@comadre/anchor-client` post-deploy del programa Anchor |
| `sendTemplate` | `lib/whatsappStub.ts` | `POST ${env.WA_URL}/reply` con `X-Internal-Auth` HMAC (mismo protocolo que `apps/api → apps/whatsapp`) |

### Env vars consumidas

| Variable | Uso |
|---|---|
| `DATABASE_URL` | Drizzle + Postgres (todos los jobs leen/escriben DB) |
| `CRON_PORT` | Puerto del servidor de health (default: 3005) |
| `LOG_LEVEL` | Pino log level |

---

## apps/indexer

**Puerto**: 3004  
**Source**: `apps/indexer/src/index.ts`  
**Estado**: esqueleto. Solo expone `/health`.

### TODO — Plan post-MVP

El indexer es el componente que materializa el estado on-chain en Postgres, haciendo al sistema de larga duración capaz de leer estado sin consultar la RPC en cada request.

**Endpoints planeados**:

| Método | Path | Descripción |
|---|---|---|
| POST | `/webhook` | Recibe enhanced transactions de Helius. Parsea logs Anchor con `EventParser` (`@coral-xyz/anchor`). Dispara handlers idempotentes por event type. |
| POST | `/reindex` | Admin: reindexar desde un slot específico. |

**Eventos a manejar** (según el README existente del servicio):

| Categoría | Eventos |
|---|---|
| Tandas | `TandaCreated`, `MemberJoined`, `ContributionMade`, `PayoutExecuted`, `TandaCompleted` |
| Disputes | `DisputeOpened`, `DisputeVoted`, `DisputeResolved` |
| Loans | `LoanRequested`, `LoanCosigned`, `LoanDisbursed`, `LoanRepaid`, `LoanDefaulted` |
| KYC/Badges | `BadgeMinted`, `KycTierUpdated` |

**Diseño esperado**:
- Cada handler debe ser idempotente: procesar el mismo evento dos veces no debe duplicar datos (usar `ON CONFLICT DO NOTHING` o `DO UPDATE` en Drizzle).
- El webhook de Helius en `apps/api /webhooks/helius` es actualmente log-only; el indexer será el consumer authoritative.
- Auth: `Authorization` header con `HELIUS_WEBHOOK_SECRET` (mismo patrón que el stub en `apps/api`).

**Deps ya declaradas en `package.json`**: `@comadre/anchor-client`, `@coral-xyz/anchor`, `@solana/web3.js`, `@comadre/db`, Drizzle, Hono, pino, zod.

---

## Notas transversales

### Comunicación inter-servicios

```
Twilio
  → apps/whatsapp POST /webhook
      → apps/agent POST /process (plain HTTP, no auth)
          → apps/api (tools via @comadre/agent-tools)

apps/api transfers.ts
  → apps/whatsapp POST /reply (X-Internal-Auth HMAC-SHA256)

apps/cron reminderJob
  → apps/whatsapp POST /reply (pendiente wiring — stub hoy)
```

### Stubs globales a reemplazar antes de mainnet

| Stub | Dónde | Blocker |
|---|---|---|
| Tx-build de tandas, users, disputes | `apps/api routes/*`, `apps/cron jobs/*` | Deploy del programa Anchor + `@comadre/anchor-client` wiring |
| KYC session real (Sumsub) | `apps/api/src/routes/kyc.ts` | Configurar `SUMSUB_APP_TOKEN` y completar integración |
| Privy webhook | `apps/api/src/routes/webhooks.ts` | Definir eventos a manejar (wallet linking, login events) |
| WA templates en cron | `apps/cron/src/lib/whatsappStub.ts` | HTTP call a `apps/whatsapp /reply` |
| KYC refresh real | `apps/cron/src/jobs/kycRefreshJob.ts` | Sumsub API integration |
| Indexer completo | `apps/indexer` | Post-MVP — requiere programa Anchor deployado |

### Dev mode

Todos los servicios soportan `bun run dev` con hot-reload (`--hot`). Para levantar el stack completo:

```bash
bun run dev   # desde la raíz — Turbo orquesta todos los servicios en paralelo
```

Variables mínimas para dev local: ver `.env.example` en la raíz del repo.
