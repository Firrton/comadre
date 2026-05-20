# Comadre — Apps reference

> Referencia técnica de los 4 servicios backend. Cada uno corre en su propio proceso Bun con Hono (excepto `apps/cron`, que usa node-cron + Hono solo para `/health`). El monorepo se orquesta con Turbo: `bun run dev` desde la raíz levanta todos los servicios en modo hot-reload.

## Service map

| App | Puerto | Responsabilidad principal | Stack clave |
|---|---|---|---|
| `apps/api` | 3001 | REST API público — Privy JWT auth, build + relay de Monad UserOps via Turnkey + Pimlico bundler, persiste off-chain state | Hono + Drizzle + Privy SDK + Turnkey SDK + Kernel v3.1 |
| `apps/whatsapp` | 3002 | Webhook entrada/salida Twilio; HMAC inter-service en `/reply` | Hono + Twilio SDK |
| `apps/agent` | 3003 | Tool-use loop con Moonshot Kimi K2; conversation state en Redis | Hono + OpenAI SDK → Moonshot/Groq baseURL |
| `apps/cron` | 3005 | Jobs scheduled (dispute 1 h, reminder/kyc diarios) | node-cron + Hono `/health` |

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
| 3 | `corsMiddleware` | `hono/cors` | `*` | CORS — restringe orígenes en producción a `comadre.lat`; `*` en dev. Headers permitidos: `Content-Type`, `Authorization`, `X-Idempotency-Key`, `X-Internal-Signature`, `X-Internal-Timestamp`, `X-Dev-Wallet`, `X-Dev-User-Id`. `maxAge: 3600`. |
| 4 | `rateLimitMiddleware` | `middlewares/rateLimit.ts` | `/api/*` excepto `/api/v1/onboarding/*` | `apiUserRateLimit` 100 req/min por `userId` (fallback a IP). Responde 429 + `Retry-After`. Transparente si Redis falla. |
| 5 | `authMiddleware` | `middlewares/auth.ts` | `/api/*` excepto `/api/v1/onboarding/*` | Verifica `Authorization: Bearer <jwt>` con Privy SDK (timeout 3 s). Sets `c.set("user", AuthUser)`. Dev bypass: `X-Dev-Wallet` + `X-Dev-User-Id` (solo `NODE_ENV !== production`). |
| 6 | `idempotencyMiddleware` | `middlewares/idempotency.ts` | POST en `/api/*` excepto `/api/v1/onboarding/*` | Requiere header `X-Idempotency-Key`. Cache key: `api:{userId}:{path}:{key}`. Cache hit → devuelve respuesta sin ejecutar handler. Redis failures son toleradas (log + pass-through). |

**Nota sobre skip de autenticación**: `/health`, `/webhooks/*` y `/api/v1/onboarding/*` son públicos. `webhooks/*` tiene su propio auth por HMAC/firma de proveedor.

### Routers

| Mount | Método | Path | Estado | Descripción |
|---|---|---|---|---|
| — | GET | `/health` | prod | Liveness check, no auth |
| `/webhooks` | POST | `/webhooks/sumsub` | prod | Verifica `X-Payload-Digest` HMAC-SHA256 si `SUMSUB_WEBHOOK_SECRET` está seteado. En evento `applicantReviewed` con resultado GREEN: actualiza `kyc_sessions.status`, actualiza `users.kycTier = "t2_standard"`, y llama `update_kyc_tier` on-chain vía `kyc_oracle`. Fallo on-chain es capturado y logueado pero no bloquea el 200. |
| `/webhooks` | POST | `/webhooks/privy` | stub | Recibe eventos de wallet linking. Loguea y responde 200. |
| `/api/v1/onboarding` | POST | `/api/v1/onboarding/monad/start` | prod | HMAC interno. Body `{ phone: E.164 }`. Crea `auth_sessions` row con magic token TTL 15 min. Envía link por Twilio SMS. |
| `/api/v1/onboarding` | GET | `/api/v1/onboarding/monad/session/:token` | prod | Devuelve `{ privyAppId, chainId, comadreAddr, usdcAddr }` para inicializar Privy en el browser. |
| `/api/v1/onboarding` | POST | `/api/v1/onboarding/monad/finalize` | prod | Body `{ token, privyUserId, ownerAddress, phoneJwt }`. Verifica JWT Privy. Llama `provisionUserAgent()` → crea sub-org + agent wallet en Turnkey. Stash `subOrgId/walletId` en memoria 5 min keyed por token. Devuelve `{ sessionAddress }`. |
| `/api/v1/onboarding` | POST | `/api/v1/onboarding/monad/install-session-key` | prod | Body `{ token, serializedBlob, smartWalletAddress, phoneJwt }`. Inserta `smart_wallets` + `session_keys` (con `turnkey_sub_org_id`, `turnkey_wallet_id`, `serialized_permission`). |
| `/api/v1/users` | POST | `/api/v1/users/init` | stub | Build stub de `init_user_profile` ix. Requiere `CreateUserProfileInput`. |
| `/api/v1/users` | POST | `/api/v1/users/:wallet/confirm` | prod | Upsert de row en `users`. Recibe `{ signature }` (verificación on-chain pendiente). El wallet del path **debe coincidir** con el usuario autenticado (CRIT-4). |
| `/api/v1/users` | GET | `/api/v1/users/me` | prod | Perfil del usuario autenticado desde Postgres. |
| `/api/v1/tandas` | POST | `/api/v1/tandas` | stub | Create tanda — build stub de `create_tanda` ix. Requiere `CreateTandaInput`. `usdc_mint` no es aceptado como input; el servidor usa `process.env.USDC_MINT` (CRIT-2). |
| `/api/v1/tandas` | GET | `/api/v1/tandas` | prod | Lista tandas del usuario (via `members` join). Paginado: `?limit&offset`. |
| `/api/v1/tandas` | GET | `/api/v1/tandas/:id` | prod | Tanda con array `members[]` ordenado por `turn_number`. Si el usuario autenticado no es miembro, `members` se omite de la respuesta (vista reducida — CRIT-1). |
| `/api/v1/tandas` | POST | `/api/v1/tandas/:id/join` | stub | Pre-flight: tanda en `forming` + hay lugar. Build stub `join_tanda`. |
| `/api/v1/tandas` | POST | `/api/v1/tandas/:id/start` | stub | Pre-flight: caller es creator + tanda `forming` + miembros completos. Build stub `start_tanda`. |
| `/api/v1/tandas` | POST | `/api/v1/tandas/:id/contribute` | stub | Pre-flight: tanda `active` + caller es member + no contribuyó este turno. Build stub `contribute`. |
| `/api/v1` (disputes) | POST | `/api/v1/tandas/:id/disputes` | stub | Abre disputa. Pre-flight: caller es member. Build stub `open_dispute`. |
| `/api/v1` (disputes) | POST | `/api/v1/disputes/:id/vote` | stub | Vota en disputa `open`. Pre-flight: caller es member del tanda + no votó antes. Build stub `vote_dispute`. |
| `/api/v1` (disputes) | GET | `/api/v1/disputes/:id` | prod | Detalle de disputa con tallies de votos. Si el usuario autenticado no es miembro de la tanda, la respuesta omite wallets de votantes, `opener` y `reason` — solo conteo agregado (HIGH-1). |
| `/api/v1/kyc` | POST | `/api/v1/kyc/session` | prod | Requiere auth. Reutiliza sesión existente solo si su estado es `init`, `pending` o `approved`. Sesiones en estado `rejected` fuerzan la creación de un nuevo applicant en Sumsub (HIGH-3). Si no hay sesión: crea applicant + inserta `kyc_sessions` row + genera access token. Devuelve `{ url, session_id, expires_at }` donde `url` es el link hospedado de Sumsub para la verificación. Stub path preservado si `SUMSUB_APP_TOKEN` no está seteado. |
| `/api/v1` (ramps) | POST | `/api/v1/onramp/quote` | mock | Fiat → USDC quote con tasas hardcodeadas (USD/ARS/MXN/COP/BRL/CLP/PEN). Válido 5 min. |
| `/api/v1` (ramps) | POST | `/api/v1/offramp/quote` | mock | USDC → Fiat quote. Mismo motor mock. |
| `/api/v1/transfers` | GET | `/api/v1/transfers/lookup` | prod | Resuelve `?phone=+E164` → registro. Respuesta reducida a `{ registered, walletPreview }` — sin `wallet`, `kycTier` ni `phoneHash` (CRIT-3). Rate limit dedicado: 20 req/min por usuario (`phoneLookupRateLimit`). |
| `/api/v1/transfers-monad` | POST | `/api/v1/transfers-monad` | prod | HMAC interno. Body `{ senderPhone, toPhone, amountUsdc, note }`. Construye `USDC.transfer(to, amount)` calldata, valida allowlist (COM-004), llama `signMonadTransfer()` → Turnkey firma → Pimlico bundler. Path inmediato (registrado) o deferred (`awaiting_recipient` TTL 7d). Persiste `transfers` row con `tx_hash`. |
| `/api/v1/elevated-intents` | POST | `/api/v1/elevated-intents/:id/confirm` | prod | Body `{ code }`. Verifica OTP via Twilio Verify. Marca `elevated_intents.status = approved` y ejecuta la acción pendiente con elevated policy ($1000 cap por 24h). |

### Lib helpers

| Archivo | Función | Descripción |
|---|---|---|
| `lib/phoneLookup.ts` | `lookupByPhone(e164)` | Resolución phone → wallet. Orden: (1) DB por `phone_hash`, (2) Privy `getUserByPhoneNumber` fallback. Retorna `{ registered, wallet, walletPreview }` internamente; el endpoint `/transfers/lookup` expone solo `{ registered, walletPreview }` (CRIT-3). Errores de Privy se tratan uniformemente como "no registrado" para evitar fingerprinting (HIGH-5). |
| `lib/monadSessionSigner.ts` | `signMonadTransfer(input)` | Recupera `turnkey_sub_org_id` + `turnkey_wallet_id` + `serialized_permission` de `session_keys`. Verifica allowlist (COM-004). Llama `turnkey.signEvmPayload()` para firmar el UserOp digest. Construye Kernel client, submite UserOp via Pimlico, espera receipt. |
| `lib/monadUsdcTransfer.ts` | `buildUsdcTransferCalldata({ to, amount })` | Encoda `transfer(address,uint256)` con viem `encodeFunctionData`. |
| `lib/phoneNormalize.ts` | `normalizePhoneE164` | E.164 con quirks MX/AR (eliminación de dígito redundante). |
| `lib/savings/contactCrypto.ts` | AES-256-GCM para contactos | `CONTACT_ENCRYPTION_KEY` es **requerida** en todos los entornos (mínimo 32 caracteres). Startup falla si no está configurada (MED-9). |
| `middlewares/errorHandler.ts` | Manejo de errores Zod | En producción retorna solo `[{path, code}]`. El `format()` completo de Zod se expone únicamente en entornos no-producción (MED-5). |
| `lib/sumsubClient.ts` | `createApplicant(userId)`, `generateAccessToken(applicantId)` | Cliente REST de Sumsub con autenticación HMAC-SHA256 por request. `createApplicant` hace POST a `/resources/applicants`; `generateAccessToken` hace POST a `/resources/accessTokens` y devuelve `{ token, url }` donde `url` apunta a `cockpit.sumsub.com/checkus#/accessToken={token}`. Requiere `SUMSUB_APP_TOKEN` + `SUMSUB_SECRET_KEY`. |

### Env vars consumidas

| Variable | Requerida | Uso |
|---|---|---|
| `PORT` | no | Puerto del servidor (default: 3001) |
| `NODE_ENV` | no | `production` desactiva dev bypass de auth |
| `PRIVY_APP_ID` / `PRIVY_APP_SECRET` | sí | Verificación JWT + wallet API (auth, onboarding, signer) |
| `DATABASE_URL` | sí | Drizzle + Postgres (Supabase recomendado) |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | sí (prod) | Rate limiting, idempotency, stash de unsigned tx |
| `MONAD_RPC_URL` | sí | RPC endpoint para Monad testnet/mainnet |
| `PIMLICO_API_KEY` / `PIMLICO_BUNDLER_URL` | sí | Bundler ERC-4337 |
| `COMADRE_CONTRACT_ADDRESS` | sí | Address del contrato Comadre.sol deployado en Monad |
| `USDC_CONTRACT_ADDRESS` | sí | Address del token USDC en Monad |
| `TURNKEY_API_PUBLIC_KEY` / `TURNKEY_API_PRIVATE_KEY` / `TURNKEY_ORGANIZATION_ID` | sí | Cliente Turnkey HSM para session key signing |
| `SUMSUB_APP_TOKEN` / `SUMSUB_SECRET_KEY` | no | Auth del cliente REST Sumsub (HMAC-SHA256 por request). Sin estas variables el endpoint `/api/v1/kyc/session` usa path stub. |
| `SUMSUB_WEBHOOK_SECRET` | no | Verificación del header `X-Payload-Digest` en `/webhooks/sumsub`. |
| `HELIUS_WEBHOOK_SECRET` | no | Auth header `/webhooks/helius` |
| `INTERNAL_HMAC_SECRET` | sí | HMAC SHA-256 para llamadas inter-servicio a `apps/whatsapp /reply` |
| `WA_URL` | sí | URL de `apps/whatsapp` (ej: `http://localhost:3002`) |
| `SKIP_REDIS` | no | `true` → bypasea Redis en tests |
| `LOG_LEVEL` | no | Pino log level (default: `info`) |
| `SENTRY_DSN` | no | Si está seteado, activa Sentry crash tracking. Trace sampling: 10% prod, 100% dev. |

### Tests

Suites en `src/__tests__/` y `src/lib/__tests__/`:

- `health.test.ts` — health check liveness
- `auth.test.ts` — Privy JWT verification + dev bypass
- `idempotency.test.ts` — middleware idempotency con Redis cache
- `onboarding.test.ts` — Monad flow: HMAC guard, validación de schema
- `transfers.test.ts` — validación Zod de body (cap, E.164, idempotency)
- `tandas.test.ts` — validación de input (member_target range, etc.)

Comando: `NODE_ENV=test bun test apps/api/` desde la raíz.

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
| POST | `/webhook` | Twilio HMAC | Webhook inbound de Twilio. Verifica `X-Twilio-Signature` con master `TWILIO_AUTH_TOKEN`. Tras la verificación aplica `webhookRateLimit` (60 req/min por número de teléfono — fail-open si Redis no responde). Extrae `From`, `Body`, `MessageSid` del form. Hace POST a `$AGENT_URL/process` firmado con HMAC-SHA256 (ver comunicación inter-servicios). Envía reply vía `sendWhatsAppMessage`. Siempre responde `<Response/>` TwiML (Twilio exige 2xx con TwiML vacío). |
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
  ↓ webhookRateLimit (60 req/min por phone — fail-open si Redis no disponible)
  ↓ firma HMAC-SHA256: X-Internal-Signature + X-Internal-Timestamp (INTERNAL_HMAC_SECRET)
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
| `INTERNAL_HMAC_SECRET` | HMAC para autenticar llamadas internas a `/reply` y firmar llamadas salientes a `apps/agent /process` |
| `SENTRY_DSN` | Opcional. Si está seteado, activa Sentry crash tracking (`@sentry/bun`). |

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
| POST | `/process` | Requiere autenticación HMAC-SHA256: headers `X-Internal-Signature` (firma) y `X-Internal-Timestamp` (epoch segundos). Ventana anti-replay: 5 min. Signature inválida o ausente → 401. Tras la verificación aplica `agentToolRateLimit` (30 tool calls/hora por `conversationKey` — fail-open si Redis no responde). Body: `{ from, body, conversationKey }`. Orquesta `resolveUser → loadHistory → runAgent → saveHistory`. Devuelve `{ reply }`. |

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

El `COMADRE_SYSTEM_PROMPT` define 5 bloques de reglas:

| Bloque | Resumen |
|---|---|
| PII (prioridad máxima) | 8 reglas: no repetir números de teléfono, wallets solo como `...XXXX`, no cruzar datos entre usuarios, no exponer IDs internos (`applicantId`, `privyUserId`, `session_id`), rechazar preguntas directas sobre phone/wallet, resistir prompt injection en contenido user-controlled. |
| Tono | Español neutro LATAM, 2–3 oraciones, nunca mencionar que es AI |
| Onboarding (sin wallet) | 3 escenarios: saludo → pedir consentimiento con texto; acción → explicar necesidad + esperar "sí"; consentido → llamar `iniciar_onboarding` |
| Transferencias | Siempre mostrar confirmación (monto + número + `walletPreview`) antes de `confirmar_transfer` |
| KYC | Tiers T0 ($20/tx) → T1 ($50) → T2 ($500) → T3 (sin límite). `solicitar_kyc` devuelve `{ url, session_id, expires_at }`. El agente debe incluir el `url` en su respuesta al usuario para que pueda completar la verificación en Sumsub. |

### Redacción de PII en respuestas de tools

El helper `redactSensitiveFields()` en `@comadre/agent-tools` envuelve el campo `data` de todos los ejecutores de tools antes de que el resultado llegue al LLM:

- Wallets → `...XXXX` (últimos 4 caracteres)
- Teléfonos → `+52...XX`
- Campos eliminados: `privyUserId`, `applicantId`, `phone_hash`, `secret_key_b58`

El parámetro `telefono` fue removido del toolset LLM-controlado de `iniciar_cuenta_segura`; el teléfono se inyecta server-side desde `context.senderPhone` para prevenir phone spoofing vía LLM.

### Env vars consumidas

| Variable | Uso |
|---|---|
| `LLM_PROVIDER` | `moonshot` (default) o `groq` |
| `MOONSHOT_API_KEY` | Requerido si `LLM_PROVIDER=moonshot` |
| `GROQ_API_KEY` | Requerido si `LLM_PROVIDER=groq` |
| `KIMI_MODEL` | Nombre del modelo (ej: `kimi-k2.6` para Moonshot, `moonshotai/kimi-k2-instruct` para Groq) |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Conversation store + rate limiting |
| `DATABASE_URL` | Lookup de usuarios (Drizzle) |
| `INTERNAL_HMAC_SECRET` | Verifica la firma HMAC-SHA256 de las llamadas entrantes desde `apps/whatsapp`. Debe coincidir exactamente con el valor en `apps/whatsapp`. |
| `SENTRY_DSN` | Opcional. Si está seteado, activa Sentry crash tracking (`@sentry/bun`). |

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
      (Twilio HMAC) → webhookRateLimit (60/min por phone)
      → apps/agent POST /process  [HMAC-SHA256: X-Internal-Signature + X-Internal-Timestamp]
          (verifica firma, ventana anti-replay 5 min → 401 si inválido)
          → agentToolRateLimit (30 tool calls/hora por conversationKey)
          → apps/api (tools via @comadre/agent-tools)

apps/api transfers.ts
  → apps/whatsapp POST /reply (X-Internal-Auth HMAC-SHA256)

apps/cron reminderJob
  → apps/whatsapp POST /reply (pendiente wiring — stub hoy)
```

**Formato de firma HMAC-SHA256 para llamadas inter-servicio (whatsapp → agent)**:

El mensaje firmado tiene la forma: `METHOD\nPATH\nTIMESTAMP\nBODY` (saltos de línea `\n` literales). La clave es `INTERNAL_HMAC_SECRET`. La firma se envía en el header `X-Internal-Signature`; el timestamp (epoch en segundos) en `X-Internal-Timestamp`. El receptor rechaza requests con timestamp fuera de la ventana de ±5 minutos.

### Stubs globales a reemplazar antes de mainnet

| Stub | Dónde | Blocker |
|---|---|---|
| Tx-build de tandas, users, disputes | `apps/api routes/*`, `apps/cron jobs/*` | Deploy del programa Anchor + `@comadre/anchor-client` wiring |
| KYC refresh real en cron | `apps/cron/src/jobs/kycRefreshJob.ts` | Sumsub GET `/resources/applicants/{id}/status` (stub hoy) |
| Privy webhook | `apps/api/src/routes/webhooks.ts` | Definir eventos a manejar (wallet linking, login events) |
| WA templates en cron | `apps/cron/src/lib/whatsappStub.ts` | HTTP call a `apps/whatsapp /reply` |
| Indexer completo | `apps/indexer` | Post-MVP — requiere programa Anchor deployado |

### Dev mode

Todos los servicios soportan `bun run dev` con hot-reload (`--hot`). Para levantar el stack completo:

```bash
bun run dev   # desde la raíz — Turbo orquesta todos los servicios en paralelo
```

Variables mínimas para dev local: ver `.env.example` en la raíz del repo.
