# Comadre — Checklist MVP Hackathon

> Última actualización: 2026-05-20 (Phase 2 — Neverland yield)
> Convenciones: 🔴 blocker crítico · 🟡 en progreso · ✅ hecho · ⏳ esperando
> Marca cada item como `- [x]` cuando esté hecho.

---

# 🎯 Tablero de producción — 2026-06-10 (AUTORITATIVO)

> Esta es la foto vigente. Todo lo que está DEBAJO de la línea "Estado de revisión 2026-06-05" es historia del proyecto (legacy Phase 0/1) y NO refleja el estado actual.

## Heat map de madurez (objetivo: todo en verde antes de mainnet)

Escala /12. "Antes" = auditoría 2026-06-09 (pre Vía B). "Ahora" = main tras Vía B + P1.

| Eje | Antes | Ahora | Estado | Qué falta para completar |
|---|---|---|---|---|
| API | 8 | 9 | 🟢 | `wallet/balance` devuelve 501 (necesita RPC Monad) |
| Auth | 7 | 9 | 🟢 | Replay cerrado en todos los endpoints internos. Nada crítico |
| Security | 5 | 8 | 🟡 | `permissionId` vacío (sin revocación on-chain); policies Neverland `to`/`onBehalfOf` sin pinear; rotación de credenciales (owner) |
| CI/CD | 4 | 9 | 🟢 | `ts` y `migrate` verdes. Falta `deploy` verde (token + config Railway, owner) |
| Database | 6 | 8 | 🟢 | Migrada y verificada en prod. Falta: transaccionalidad savings, job de reconciliación (depende del indexer) |
| DR | 4 | 5 | 🟡 | Runbook escrito. Falta: PITR de Supabase (owner) + 1 simulacro de restore real |
| Scaling | 1 | 6 | 🟡 | api ya escala >1 réplica (Maps→Redis). cron sigue clavado en 1 (sin lock distribuido) |
| Hosting | 5 | 6 | 🟡 | Config-as-code lista. Falta: `RAILWAY_TOKEN` + Config File Paths + primer deploy real (owner) |
| Logs | 7 | 8 | 🟡 | PII redactada. Falta: cliente BetterStack (token existe, sin uso); `SENTRY_DSN` en prod (owner) |
| RLS | 1 | 1 | ⚪ | Ausente. N/A para arquitectura single-tenant custodial — no bloquea |
| Load Balancing | 1 | 1 | ⚪ | Ausente. No bloquea para testnet single-instance |

**Huecos grandes que el heat map de 12 ejes NO cubre (alcance MVP):**

- 🔴 **Indexer de Monad** — `recibir-con-aviso` no existe (0 código). Único pilar del MVP en cero. Además destraba el job de reconciliación pending-vs-chain.
- 🟡 **Canal OpenWA** — decisión tomada 2026-06-10: OpenWA, fuera Twilio. `apps/whatsapp` es adaptador Twilio de punta a punta; hay que migrarlo.
- 🟡 **Validación E2E en testnet** — nada del camino del dinero se probó aún contra Monad + WhatsApp reales.

---

## Pasos para completar el mapa, en orden — con puntos de reinicio de sesión

> 🔄 = buen momento para **limpiar la sesión** (`/clear`) y arrancar fresca. Regla: reiniciar al cambiar de workstream grande (cada SDD trae contexto nuevo; el detalle de la ejecución anterior es ruido). NO reiniciar en medio de una verificación corta o un loop de dashboard.

### Paso 1 — Cerrar el deploy (owner, dashboard, sin código) — SESIÓN ACTUAL
- [ ] Crear `RAILWAY_TOKEN` secret (Railway → Account/Project Settings → Tokens → `gh secret set RAILWAY_TOKEN`)
- [ ] Por servicio (api, agent, whatsapp, cron): Settings → Config File Path → `/infra/railway.<svc>.toml`
- [ ] cron → Settings → Replicas → 1
- [ ] Re-disparar `gh run rerun 27288220609 --failed` → `deploy` verde
- [ ] Mergear PR #51 (baseline.ts)
- → Cierra: **CI/CD 🟢, Hosting → 8**
- 🔄 **Reiniciar sesión DESPUÉS de que el deploy esté verde.** Antes no: este loop es corto y conviene mantener el contexto de los IDs de run y los secrets.

### Paso 2 — Validación E2E en testnet (sesión fresca)
- [ ] Onboarding real → wallet Monad provisionada (Turnkey)
- [ ] Envío a destinatario NUEVO → prompt de confirmación → "sí" → tx on-chain
- [ ] Segundo envío al mismo destinatario → sin confirmación
- [ ] Doble "sí" concurrente → una sola tx (CAS)
- [ ] Exceder 100 USDC/24h → rechazo con mensaje claro
- [ ] Webhook duplicado de WhatsApp → procesado una sola vez
- → Valida: el camino del dinero entero en condiciones reales
- 🔄 **Reiniciar ANTES de empezar.** Es un workstream nuevo (verificación de comportamiento), no necesita el historial de implementación.

### Paso 3 — Indexer de Monad (sesión fresca, SDD completo)
- [ ] SDD: explorar → proponer → spec → diseño → tasks
- [ ] Indexer que escucha transfers USDC entrantes a wallets de usuarios
- [ ] `recibir-con-aviso`: notificación por WhatsApp al recibir
- [ ] Job de reconciliación: filas `pending`/`confirmed` vs estado on-chain
- → Cierra: **el hueco MVP más grande** + Database → 9 (transaccionalidad)
- 🔄 **Reiniciar ANTES.** SDD grande, merece contexto limpio.

### Paso 4 — Canal OpenWA (sesión fresca, SDD completo)
- [ ] SDD del bridge OpenWA (sesión de browser persistente, dedup de message-id, auth bridge↔backend)
- [ ] Reemplazar webhook + send de Twilio
- [ ] Purgar deps `twilio` + env vars `TWILIO_*` + código de firma Twilio
- [ ] Actualizar docs FLOWS/SECURITY
- → Cierra: deuda de canal, ejecuta decisión del 2026-06-10
- 🔄 **Reiniciar ANTES.** Workstream independiente.

### Paso 5 — Hardening P2 de seguridad (sesión fresca)
- [ ] `permissionId` real al instalar session key (habilita revocación on-chain)
- [ ] Pinear `to`/`onBehalfOf` en policies Neverland (`wallet-infra/policies.ts`)
- [ ] Transaccionalidad en confirmaciones de savings
- → Cierra: **Security → 10+**
- 🔄 **Reiniciar ANTES.**

### Acciones de owner transversales (sin sesión, cuando puedas)
- [ ] Rotar credenciales de Twilio (en git history) + secretos vivos en `.env`/`.env.local` + **password de la DB** (quedó en transcript)
- [ ] Habilitar PITR de Supabase + anotar fecha en `docs/SECURITY.md` → DR
- [ ] Provisionar `SENTRY_DSN` en Railway → Logs

---

## PRs viejos a cerrar (limpieza)
- #27 (recipient-allowlist) — superseded por #38-#40, **cerrar**
- #19, #20, #24, #25 — stale/legacy, revisar y cerrar

---

## 🧭 Estado de revisión — sesión Monad (2026-06-05, branch `claude/laughing-ishizaka-263771`)

> ⚠️ Gran parte de este CHECKLIST es **legacy Phase 0 (Solana / Anchor / Twilio / Helius)** y NO refleja la stack actual. Realidad vigente: **Monad / EVM / ZeroDev (AA) / Turnkey / Pimlico**; WhatsApp migrando a **open-wa** (Twilio aún presente en el código). Tomar lo de abajo con pinzas.

**Revisión de arquitectura por área (heatmap de madurez):**

- **API (`apps/api`) — ✅ revisada y estable a nivel estructura.** Framework (Hono/Bun), routing, cadena de middlewares y superficie de endpoints están sólidos. **NO reestructurar** (no reescribir router/middlewares ni mover endpoints). La sección detallada `### apps/api ✅` más abajo es legacy — esta nota es la verdad vigente.
- **AUTH — 🟡 hardening EN CURSO en esta branch.** Edita archivos DENTRO de `apps/api`; **no revertir**:
  - ✅ **F-2** IDOR en `routes/elevatedIntents.ts` — fixeado + testeado (helper nuevo `lib/ownership.ts`).
  - ⏳ Pendientes: **F-5** `middlewares/auth.ts` (extracción de wallet EVM), **F-3** `middlewares/auth.ts` (dev-bypass fail-closed), **F-4** `routes/webhooks.ts` (replay protection Sumsub), **F-1** `routes/ramps.ts` (`user_wallet` del body), **F-7** `routes/wallet.ts` (header `X-Mock-USDC-Balance`), **F-6** `routes/onboarding.ts` (nonce dedup → Redis).
- Resto de áreas (Database, Security on-chain, Hosting, CI/CD, DR, RLS, Load Balancing, Scaling, Logs) — ver heatmap; aún sin revisión profunda.

**Para el próximo agente:** la API es estable a nivel estructura — **no la reescribas**. Los únicos cambios activos en `apps/api` son las correcciones de AUTH listadas arriba (en esta branch). Coordiná, no pises.

---

## 🌱 Phase 2 — Yield (Neverland) (2026-05-20)

Estado: ✅ implementado. Pendiente: activación en producción (env vars) + upgrade de session keys para usuarios pre-Phase 2.

- [x] **`neverlandAdapter.ts`** — core adapter: `depositToNeverland`, `withdrawFromNeverland` (fee 20% en yield), `readNeverlandPosition`, `readNeverlandApy`
- [x] **`neverlandSavingsAdapter.ts`** — implementación de la interfaz `SavingsAdapter` en la capa de estrategia
- [x] **`packages/wallet-infra/src/sessionKey/policies.ts`** — 4 políticas Neverland opcionales (USDC.approve, Pool.supply, Pool.withdraw, USDC.transfer a feeWallet)
- [x] **`packages/db/drizzle/migrations/0004_neverland.sql`** — migración: enum `neverland` en `savings_provider`, columna `principal_withdrawn_micro_usdc` en `savings_positions`
- [x] **`packages/config/src/env.ts`** — variables de entorno: `NEVERLAND_POOL_ADDRESS`, `NEVERLAND_POOL_ADDRESSES_PROVIDER`, `NEVERLAND_UI_POOL_DATA_PROVIDER`, `NEVERLAND_N_USDC_ADDRESS`, `NEVERLAND_DUST_REWARDS_CONTROLLER`, `COMADRE_YIELD_FEE_BPS`, `COMADRE_FEE_WALLET`, `YIELD_STRATEGY_PROVIDER`
- [x] **`apps/agent/src/lib/systemPrompt.ts`** — sección Guardadito reescrita: comparación banco Bolivia, lenguaje "tu chanchito", transparencia del fee 20%
- [x] **23 unit tests** de fee math en `neverlandAdapter.test.ts`
- [ ] **Activar `YIELD_STRATEGY_PROVIDER=neverland` en producción** — configurar todas las vars `NEVERLAND_*` y `COMADRE_FEE_WALLET` en el entorno de producción
- [ ] **Upgrade de session keys** para usuarios que hicieron onboarding antes de Phase 2 (no tienen políticas Neverland en su Kernel permission)
- [ ] **Migración DB** `0004_neverland.sql` aplicada en Supabase producción
- [ ] **Verificar addresses Neverland** en Monad mainnet antes de activar (Pool: `0x80F00661b13CC5F6ccd3885bE7b4C9c67545D585`, nUSDC: `0x38648958836eA88b368b4ac23b86Ad44B0fe7508`)

---

## 🚀 Phase 1 — Monad migration (2026-05-20)

Estado: en progreso. Cambios arquitectónicos completados o en marcha:

- [x] **Turnkey HSM custody** para session keys (replaces AWS KMS envelope encryption)
- [x] **Sub-organization per user** — cada usuario tiene su propia sub-org Turnkey con su agent wallet
- [x] **DB schema migration** — drop `user_keypairs`; `session_keys` ahora apunta a Turnkey (no más ciphertext local)
- [ ] **Solana legacy code eliminado** — packages `anchor-program`, `anchor-client`, `solana` borrados; lib files Solana removidos de `apps/api`; `apps/indexer` borrado
- [ ] **Onboarding flow Monad** wireado con Turnkey (provisión de sub-org en `/monad/finalize`)
- [ ] **Transfer flow Monad** wireado con Turnkey signing + allowlist enforcement (COM-004)
- [ ] **Elevated intents (OTP escalation)** wireado para montos > cap KYC tier
- [ ] **Docs refresh** — ARCHITECTURE, BACKEND, APPS, SECURITY, RUNBOOK migrados a Monad-only
- [ ] **All tests passing** — bun test cross-apps + forge test

Las secciones Solana abajo se mantienen como **historia del proyecto** (Phase 0). Todo lo marcado relacionado con Anchor/Solana es **legacy** y se está reemplazando con la stack Monad/Turnkey/Privy/Kernel descripta arriba.

---

## 📊 Estado del proyecto (resumen)

| Área | Estado | Detalle |
|---|---|---|
| Monorepo & scaffold | ✅ | Bun + Turborepo, 7 apps + 8 packages, CI funcional |
| Anchor program | 🟡 | `init_user_profile`, `update_kyc_tier`, `init_config` mergeados (PR #3). Tanda lifecycle en `feat/anchor-tanda-flow` (otro agente) |
| `packages/types` (Zod) | ✅ | PR #2 mergeado |
| `packages/config` (env) | ✅ | PR #1 mergeado |
| `packages/db` (Drizzle) | 🟡 | Schemas + client en `feat/drizzle-schemas` (otro agente) |
| `packages/cache` (Upstash) | 🟡 | Cache helpers en `feat/upstash-cache` |
| `apps/whatsapp` (Twilio) | ✅ | Webhook + reply HMAC + rate limit (60/min por phone) + HMAC outbound a agent |
| `apps/agent` (Kimi) | ✅ | Tool-use loop + HMAC inbound verificado + rate limit (30 tool calls/hr); smoke-test E2E pasado (kimi-k2.6, LATAM Spanish, Redis OK) |
| APIs externas | 🟡 | Helius ✓, Privy ✓, Twilio ✓ (con master token, no API key todavía); Kimi ✓ (kimi-k2.6), Upstash ✓ |
| Demo E2E | 🔴 | Bloqueado por: agent service no listo + credenciales pendientes |

---

## 🎯 Decisiones técnicas cerradas

### Stack
- **Smart contracts:** Rust + Anchor 0.31 (con pin de transitive deps por edition2024)
- **Backend runtime:** Bun 1.2+ (no Node)
- **Web framework:** Hono 4
- **Lenguaje:** TypeScript 5.7+ strict
- **ORM:** Drizzle 0.36+
- **DB:** Postgres (Supabase)
- **Cache/queue:** Upstash Redis
- **Mobile:** Expo SDK 52 + Solana Mobile Stack
- **Web:** Next.js 15
- **Auth:** Privy (embedded wallets + Solana)
- **KYC:** Sumsub tiered (T0/T1/T2/T3)

### Servicios externos
- **WhatsApp:** **Twilio** (NO Meta) — sandbox `whatsapp:+14155238886`
- **Auth Twilio:** **API Keys (SK...)** para outbound + Auth Token para webhook signature verify
- **LLM:** **Kimi K2** vía **Moonshot directo o Groq** (TBD según qué API key tenga el usuario)
- **RPC Solana:** Helius (devnet/mainnet)
- **Voice (Fase 2):** ElevenLabs Conversational AI

### Reglas del programa Anchor
- Stake-to-join 1x contribution
- Payout order MVP: `CreatorSet`
- Backend paga rents (descuenta del fee 0.5%)
- Crank híbrido (cron interno + callable por anyone)
- Yield on-chain vía Neverland (Aave V3 fork en Monad mainnet) — integrado en `YIELD_STRATEGY_PROVIDER=neverland`. Fee: 20% sobre yield únicamente. Mínimo $1 USDC. Recompensas MON+DUST al 100% a Comadre.
- Tandas autónomas (1 persona crea), grupo WhatsApp solo si hay tiempo

---

## 🛠 Fase 0 — Setup

### Repo & tooling
- [x] Repo público en GitHub: `Firrton/comadre`
- [x] Estructura monorepo (`apps/*`, `packages/*`)
- [x] `.gitignore`, `.editorconfig`, `LICENSE` MIT, `CONTRIBUTING.md`
- [x] `package.json` raíz + Bun workspaces + Turborepo
- [x] `tsconfig.base.json`
- [x] CI workflow (TS lint/typecheck + Anchor build)
- [ ] **Invitar collaborators al repo**
- [ ] **Branch protection en `main`** (require PR + 1 review, status check CI)
- [ ] CODEOWNERS (ya existe pero hay que poblarlo con team members reales)

### Cuentas externas
- [x] Helius — devnet API key activa, RPC verificado funcional (Solana 4.0.0-rc.0)
- [x] Privy — app creada, credenciales válidas (verificado con `GET /users`)
- [x] Twilio — account activo, sandbox `+14155238886`, primer template `HX350d...` aprobado
- [ ] 🔴 **Twilio API Key (SK...)** — crear en console.twilio.com, scope `Main`. Sustituye a Auth Token para outbound
- [ ] 🔴 **Twilio Auth Token rotado** — el master se filtró. Solo se usará para webhook signature verify
- [ ] 🔴 **Upstash Redis** — free tier, copiar `REST_URL` + `REST_TOKEN`
- [ ] 🔴 **Kimi/Moonshot OR Groq API key** — provider TBD. Usuario tiene Kimi directo (Moonshot)
- [ ] 🔴 **Supabase** — crear proyecto, copiar `DATABASE_URL` con `?pgbouncer=true&connection_limit=1`
- [x] Sumsub — integración REST real en `apps/api` (backend-hosted flow). Requiere `SUMSUB_APP_TOKEN` + `SUMSUB_SECRET_KEY` + `SUMSUB_WEBHOOK_SECRET` en `.env`.
- [x] Sentry — `@sentry/bun` inicializado en `apps/api`, `apps/agent`, `apps/whatsapp` (activado via `SENTRY_DSN`)
- [ ] Better Stack — log source (post-MVP)
- [ ] Railway — project + GitHub integration (deploy)
- [ ] Vercel — para `apps/web` (deploy)
- [ ] ngrok — auth token para webhook tunneling local
- [ ] ElevenLabs — Fase 2

### Credenciales en `.env`
- [x] `SOLANA_RPC_URL` con Helius API key embebida
- [x] `FEE_PAYER_SK` (sponsor wallet `7yLRNcZkbjQfu4xsyvewpVAcgFd4fD8pBLKahRFT64bS`)
- [x] `PRIVY_APP_ID` + `PRIVY_APP_SECRET`
- [x] `TWILIO_ACCOUNT_SID`
- [x] `TWILIO_WHATSAPP_FROM`
- [ ] 🔴 `TWILIO_AUTH_TOKEN` — **rotado** (no el filtrado)
- [ ] 🔴 `TWILIO_API_KEY_SID` (SK...) + `TWILIO_API_KEY_SECRET`
- [ ] 🔴 `MOONSHOT_API_KEY` (o `GROQ_API_KEY` según provider) + `KIMI_MODEL`
- [ ] 🔴 `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`
- [x] `INTERNAL_HMAC_SECRET` — generar con `openssl rand -hex 32`
- [ ] `PRIVY_VERIFICATION_KEY` — descargar de Privy dashboard

### Wallets de Solana (devnet)
- [x] `fee_payer` keypair (`7yLRNcZ...`)
- [ ] 🔴 **Devnet airdrop a `fee_payer`** — Helius rate-limited (1 SOL/día/proyecto). Usar [faucet.solana.com](https://faucet.solana.com)
- [ ] `crank_authority` keypair generado + airdrop
- [ ] `kyc_oracle` keypair generado + airdrop
- [ ] `admin` keypair generado + airdrop
- [ ] Migrar SKs a vault (Doppler/Infisical) — POST-HACKATHON, por ahora `.env`

### Local dev environment
- [x] Bun 1.3.13 instalado en `~/.bun/bin/`
- [x] Rust toolchain + cargo
- [x] Solana CLI 2.1.7 (Agave)
- [x] Anchor 0.31.0 vía avm (con `procmacro2_semver_exempt` workaround)
- [x] Platform-tools v1.43 (rust 1.79 fork)
- [x] Cargo.lock pinned para evitar edition2024 conflicts
- [x] `.cargo/config.toml` con `rustflags = ["--cfg=procmacro2_semver_exempt"]`
- [ ] Postgres local (Supabase remoto basta para hackathon)

---

## ⚓ Fase 1 — Smart Contract Anchor

### Programa base (mergeado en `main` via PR #3)
- [x] `Anchor.toml`, `Cargo.toml` workspace + program
- [x] State accounts: `UserProfile`, `Tanda`, `Member`, `Dispute`, `DisputeVote`, `Loan`, `LoanCosigner`, `ReputationBadge`, `ProgramConfig`
- [x] Enums: `TandaState`, `KycTier`, `DisputeState`, `LoanState`, `BadgeType`, `PayoutOrder`
- [x] Errors: 22 codes
- [x] Events: 14 events emitidos por handlers
- [x] `init_config` (singleton, deployer-only guard con cfg-feature `localnet`)
- [x] `init_user_profile` (con `require!` de phone_hash + country_code)
- [x] `update_kyc_tier` (validación de oracle vs config)
- [x] `pause` / `unpause` admin
- [x] Anchor build pasa, IDL generado, TS types exportados
- [x] Tests TS de user/admin instrucciones

### Tanda lifecycle (en progreso — `feat/anchor-tanda-flow`)
- [x] `create_tanda` — handler implementado con vault PDA + crear tanda
- [x] `join_tanda` — handler con stake transfer
- [x] `start_tanda` — solo creator, valida member_current == member_target
- [x] `contribute` — transfer USDC user → vault
- [x] `payout` — vault → beneficiary, advance turn, mark received
- [x] `slash_defaulter` — burn member stake si no contribuyó
- [x] `complete_tanda` — return stakes + mint badges
- [ ] PR review + merge a `main`
- [ ] Tests TS E2E del lifecycle (parcial en `tanda.spec.ts`)

### Disputes
- [ ] `open_dispute` — pause tanda, create Dispute account
- [ ] `vote_dispute` — solo members, PDA-enforced unique vote
- [ ] `resolve_dispute` — apply majority post-deadline
- [ ] Tests dispute flow

### Loans (Fase 2 post-MVP)
- [ ] `request_loan`
- [ ] `cosign_loan`
- [ ] `disburse_loan`
- [ ] `repay_loan`
- [ ] `default_loan` (slash co-signers)

### Deploy
- [ ] `anchor deploy --provider.cluster devnet`
- [ ] Update `declare_id!` con program_id real
- [ ] `anchor idl init` (subir IDL on-chain)
- [ ] `bun run codegen:client`
- [ ] Verificar program en explorer.solana.com (devnet)

---

## 🟦 Fase 2 — Backend Services

### `packages/types` ✅ (PR #2 mergeado)
- [x] Zod schemas: inputs, responses, webhooks
- [x] Type-safe enums alineados con on-chain

### `packages/config` ✅ (PR #1 mergeado)
- [x] Zod env loader con fail-fast
- [x] Singleton `env` y `loadEnv()` lazy
- [x] Schemas por dominio (Solana, wallets, Privy, etc.)
- [ ] **Agregar `twilioSchema`** (con `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET` además del Auth Token)
- [ ] **Agregar `llmSchema`** (Moonshot/Groq + Kimi model)

### `packages/db` 🟡 (en progreso — `feat/drizzle-schemas`)
- [x] Drizzle schema con 12 tablas (users, tandas, members, disputes, etc.)
- [x] Postgres native enums alineados con on-chain
- [x] Drizzle client singleton con pgbouncer support
- [ ] Migration scripts (`scripts/migrate.ts`)
- [ ] Indexer integration (Helius webhook → upsert)
- [ ] PR review + merge

### `packages/cache` 🟡 (en progreso — `feat/upstash-cache`)
- [x] Upstash Redis client singleton lazy
- [x] Idempotency cache (`getIdempotent`, `setIdempotent`, `withIdempotency`)
- [x] Rate limiting helpers (api/agent/webhook limiters)
- [x] WhatsApp 24h window helpers
- [ ] PR review + merge

### `apps/whatsapp` ✅ (Twilio)
- [x] Hono app port 3002
- [x] `GET /health`
- [x] `POST /webhook` con `X-Twilio-Signature` HMAC verification (Twilio SDK)
- [x] Parseo form-urlencoded de Twilio
- [x] Forward al agent service via `AGENT_URL`
- [x] `POST /reply` interno con HMAC-SHA256 auth
- [x] Rate limiting `webhookRateLimit` (60 req/min por phone) wired en POST /webhook
- [x] **MessageSid dedup** — `SET NX EX 300` en `wa:msgsid:{sid}`, fail-open, guard `SKIP_REDIS` / `NODE_ENV=test` (D1 BLOCKER resuelto)
- [x] HMAC-SHA256 outbound a `apps/agent /process` (`X-Internal-Signature` + `X-Internal-Timestamp`)
- [x] Sentry inicializado (`@sentry/bun`)
- [x] Tests pasan (4/4 whatsapp + 6/6 cache)
- [x] Typecheck pasa
- [ ] **Migrar a Twilio API Key** (SK...) en lugar de master Auth Token
- [ ] Templates aprobados con Twilio:
  - [ ] `tanda_recordatorio`
  - [ ] `tanda_payout_listo`
  - [ ] `kyc_pendiente`
- [ ] Deploy a Railway con webhook URL pública

### `apps/agent` ✅ Kimi K2 via Moonshot/Groq — smoke-test verificado
- [x] **Provider**: Moonshot directo (`kimi-k2.6`). Groq path existe en código pero no verificado.
- [x] Cliente OpenAI SDK con baseURL custom según provider
- [x] `POST /process` — recibe `{from, body, conversationKey}` — responde en LATAM Spanish
- [x] HMAC-SHA256 inbound verificado con ventana anti-replay de 5 min → 401 si inválido
- [x] Rate limiting `agentToolRateLimit` (30 tool calls/hora por conversationKey) wired en POST /process
- [x] Tool use loop (max 5 iterations)
- [x] System prompt "tía cariñosa LATAM" en español
- [x] Conversation state en Redis con TTL 24h (`agent:conv:<conversationKey>`)
- [x] Sentry inicializado (`@sentry/bun`)
- [x] Tests (health, validación, executeTool)
- [x] Typecheck pasa
- [ ] Tools end-to-end con `apps/api` real (pendiente de test pass separado)

### `packages/agent-tools` 🟡
- [x] Estructura registry de tools (20 tools registradas en ALL_TOOLS)
- [x] `consultar_balance` — llama `GET /api/v1/wallet/balance` (saldo USDC on-chain real; antes apuntaba por error a `/users/me`)
- [x] `mis_tandas` — llama `GET /api/v1/tandas`, lista tandas del usuario; sin argumentos
- [ ] `crear_tanda`, `unirse_tanda`, `consultar_tanda` (post-MVP)
- [ ] `aportar_turno`
- [ ] Tools NUNCA firman tx — solo llaman API service

### `apps/api` ✅
- [x] Hono port 3001
- [x] CORS middleware (`hono/cors`) — producción: `comadre.lat`; dev: `*`
- [x] Auth middleware (Privy JWT verify)
- [x] Idempotency middleware
- [x] Rate limit middleware (`apiUserRateLimit` 100 req/min por usuario)
- [x] Sentry inicializado (`@sentry/bun`)
- [x] Endpoints: `/users`, `/tandas`, `/members`, `/disputes`, `/kyc`, `/onramp`, `/offramp`
- [x] Webhook handlers: `/webhooks/sumsub`, `/webhooks/privy`
- [x] KYC Sumsub integrado: `sumsubClient.ts`, `POST /api/v1/kyc/session` (real cuando `SUMSUB_APP_TOKEN` seteado), webhook `applicantReviewed GREEN` actualiza DB + on-chain `update_kyc_tier`

### `apps/indexer` ⏳ (no iniciado)
- [ ] Helius webhook config
- [ ] Anchor `EventParser` setup
- [ ] Handlers por evento (TandaCreated, MemberJoined, ...)
- [ ] Upsert idempotente a Postgres

### `apps/cron` ⏳ (no iniciado)
- [ ] `payoutCrank` (cada 5 min)
- [ ] `disputeResolveCrank` (cada hora)
- [ ] `reminderJob` (diario 9am)
- [ ] `kycRefreshJob` (diario 4am)

---

## 🌐 Fase 3 — Integración E2E (próximo)

### Hito 1 — Echo bot
- [ ] ngrok corriendo apuntando a `:3002`
- [ ] Twilio sandbox webhook configurado a URL ngrok `/webhook`
- [ ] **Confirmar `join <código>` desde tu WhatsApp al `+14155238886`**
- [ ] Mandar "hola" → recibir "Echo: hola" (bypass del agent service)
- [ ] **Verifica:** webhook funciona, signature valida, reply funciona

### Hito 2 — Kimi text-only
- [ ] Levantar `apps/agent` en `:3003`
- [ ] WhatsApp service llama agent service
- [ ] Agent llama Kimi sin tools
- [ ] Mandar "hola comadre" → respuesta conversacional de Kimi
- [ ] **Verifica:** Kimi responde como agente

### Hito 3 — Kimi con tool use
- [ ] Definir tool `consultar_perfil(wallet)` mock
- [ ] Kimi decide cuándo llamarlo
- [ ] Loop tool use hasta respuesta final
- [ ] Mandar "¿cuál es mi saldo?" → Kimi llama tool → responde con datos mock
- [ ] **Verifica:** base agéntica funciona

### Hito 4 — Kimi con tools reales (post-tanda merge)
- [ ] Tools llaman `apps/api` real
- [ ] `crear_tanda` end-to-end con tx unsigned → cliente firma → broadcast
- [ ] `aportar_turno` con USDC real (devnet mint)
- [ ] `consultar_tanda` con datos del indexer

---

## 📱 Fase 4 — Mobile (no iniciado)

### Setup base
- [ ] Expo SDK 52 init
- [ ] Privy provider + embedded wallet
- [ ] MWA provider (Solana Mobile)
- [ ] Login con phone OTP via Privy

### Pantallas core
- [ ] Home — lista mis tandas
- [ ] Crear tanda
- [ ] Detalle tanda
- [ ] Join via deep link (`comadre://join/:id`)
- [ ] Aportar turno modal
- [ ] KYC con Sumsub WebSDK
- [ ] Profile

### dApp Store
- [ ] EAS build APK firmado
- [ ] Publisher Portal submission (review 3-5 días — empezar día -7)
- [ ] dApp store listing assets

### Voice (Fase 2 post-MVP)
- [ ] ElevenLabs Conversational AI agent setup
- [ ] React Native SDK integration

---

## 🌍 Fase 5 — Web (`apps/web`)

- [ ] Landing page + waitlist
- [ ] `/admin` con Privy gate (allowlist de wallets)
- [ ] Tablas: tandas activas, KYC pendientes, disputas

---

## 🎬 Fase 6 — Demo & Pitch

### Pre-demo
- [ ] Video demo 3 min (script + grabación + edición)
- [ ] README con quickstart claro y reproducible
- [ ] Pitch deck (8-10 slides)
- [ ] Landing en `comadre.lat` con waitlist

### Submissions
- [ ] Colosseum hackathon
- [ ] Solana Mobile track
- [ ] ElevenLabs track (si voice está listo)
- [ ] Twitter/X thread anuncio

---

## 🔒 Seguridad (audit sprint A — 2026-05-19)

> Hallazgos del audit completo. Ver `docs/SECURITY.md` para el detalle completo.

### API (`apps/api/`)
- [x] **CRIT-1** `GET /api/v1/tandas/:id` — membership check; vista reducida a no-miembros (sin `members`).
- [x] **CRIT-2** `POST /api/v1/tandas` — `usdc_mint` removido del input schema; servidor usa `process.env.USDC_MINT`.
- [x] **CRIT-3** `GET /api/v1/transfers/lookup` — respuesta reducida a `{ registered, walletPreview }`; rate limit 20 req/min.
- [x] **CRIT-4** `POST /api/v1/users/:wallet/confirm` — wallet del path debe coincidir con el usuario autenticado.
- [x] **HIGH-1** `GET /api/v1/disputes/:id` — membership check; votos detallados solo a miembros.
- [x] **HIGH-3** `POST /api/v1/kyc/session` — reutiliza sesión solo en estado `init/pending/approved`; `rejected` fuerza nuevo applicant.
- [x] **HIGH-5** `lib/phoneLookup.ts` — errores de Privy tratados uniformemente como "no registrado".
- [x] **MED-9** `lib/savings/contactCrypto.ts` — `CONTACT_ENCRYPTION_KEY` requerida en todos los entornos, mínimo 32 chars.
- [x] **MED-5** `middlewares/errorHandler.ts` — producción expone solo `[{path, code}]`; `format()` completo solo en dev.

### Agente PII (`apps/agent/`, `packages/agent-tools/`)
- [x] System prompt — 8 reglas PII de prioridad máxima.
- [x] `redactSensitiveFields()` — wallets → `...XXXX`, phones → `+52...XX`; drop de `privyUserId`, `applicantId`, `phone_hash`, `secret_key_b58` en los 21 ejecutores de tools.
- [x] `iniciar_cuenta_segura` — `telefono` removido del toolset LLM-controlado; inyectado server-side.

### Solana Anchor (`packages/anchor-program/`)
- [x] **CRIT-1** `init_user_profile` — `wallet` es `Signer<'info>` (previene impersonación).
- [x] **HIGH-4** `payout.rs` — schedule rolling (`prev_ts + frequency_seconds`).
- [x] **HIGH-5** `pause.rs` — emite evento `ProgramPauseStateChanged`.
- [ ] **CRIT-3** Vault lockup tras slash — pendiente redesign (documentado en `slash.rs`).
- [ ] **CRIT-4** Slash envía stake a treasury en vez de cubrir contribución — pendiente (documentado en `slash.rs`).

### Solidity (`packages/monad-contracts/`)
- [x] **CRIT-02** Disputes vinculadas al `tandaKey`; cross-tanda voting bloqueado con `DisputeTandaMismatch`.
- [x] **CRIT-03** Quorum mínimo `ceil(memberTarget/2)`; sin quorum → estado `Expired`.
- [x] **HIGH-01** Setters de roles verifican `address(0)`.
- [x] **HIGH-02** Constructor valida todas las direcciones no nulas.
- [x] **HIGH-05** `resolveDispute` refresca `nextPayoutTs` al retornar a `Active`.
- [x] **HIGH-06** `initUserProfile` exige `msg.sender == wallet`.
- [x] **MED-05** `payout` usa schedule rolling.
- [x] **MED-08** `MAX_FEE_BPS` reducido a 300 (3%).
- [x] **LOW-05** `createTanda` exige `frequency <= MAX_FREQUENCY = 90 days`.
- [ ] **CRIT-01** Vault lockup tras slash — pendiente redesign (documentado en `slashDefaulter`).
- [ ] **CRIT-04** Dispute griefing gratuito — pendiente bond on dispute opening (documentado en `openDispute`).

---

## 🚨 Riesgos detectados (mitigación pendiente)

- 🔴 **Twilio Auth Token filtrado** — `e37fc5...d9d` quedó en transcript del chat. **ROTAR INMEDIATAMENTE**
- 🔴 **Sponsor wallet con 0 SOL** — necesita airdrop devnet (rate-limited, usar faucet web)
- 🔴 **Sandbox no joined** — sin `join <código>`, mensajes nunca llegan
- 🟡 **Multi-agente paralelo** — varios agentes haciendo PRs distintos. Coordinación de merges + branch hygiene
- 🟡 **Twilio template approval** — `HX350d...` ya OK, pero los nuevos para Comadre necesitan aprobación 24-48h
- 🟡 **dApp Store review** — 3-5 días, empezar día 1 del sprint mobile
- ✅ **Idempotencia E2E** — wired en `apps/api`; rate limiters wired en los 3 servicios
- 🟢 **Kimi provider** — Moonshot directo (`kimi-k2.6`). Verificado funcional. Groq path configurado en código pero no testeado.
- 🟢 **Anchor build pipeline** — resuelto con pin de transitive deps + `procmacro2_semver_exempt` flag

---

## 🌳 Branches activas (multi-agente)

| Branch | Estado | Owner | Ready to merge? |
|---|---|---|---|
| `main` | base | — | — |
| `feat/anchor-tanda-flow` | 🟡 implementación | otro agente | Próximo |
| `feat/kimi-agent` | 🟡 implementación (worktree `comadre-kimi`) | otro agente | Pendiente |
| `feat/twilio-whatsapp` | ✅ código + tests | yo | Sí, después de fix env schema |
| `feat/drizzle-schemas` | 🟡 schemas listos | otro agente | Próximo |
| `feat/upstash-cache` | 🟡 helpers listos | otro agente | Próximo |
| `feat/anchor-user-admin-handlers` | ✅ mergeado (PR #3) | — | — |
| `feat/zod-schemas` | ✅ mergeado (PR #2) | — | — |
| `feat/env-loader` | ✅ mergeado (PR #1) | — | — |
| `chore/exclude-frontend-from-workspace` | ✅ mergeado (PR #4) | — | — |

---

## ✅ Definición de "Done" para MVP

- [ ] Demo en vivo: usuario manda "hola" por WhatsApp → Comadre (Kimi) responde en español → usuario pide "crear tanda con María, Ana y Luisa" → Comadre llama tool → on-chain tanda creada → confirmación devuelta
- [ ] Programa Anchor desplegado en devnet, IDL on-chain
- [ ] CI verde
- [ ] README con instrucciones para reproducir el demo (juez de Colosseum debe poder seguirlo)
- [ ] Video demo público en X/Twitter
- [ ] Submission en Colosseum portal

---

## 📋 Próximas acciones inmediatas (orden sugerido)

1. **Tú:**
   - 🔴 Rotar Twilio Auth Token
   - 🔴 Crear Twilio API Key (SK...)
   - 🔴 Confirmar provider Kimi (Moonshot directo o Groq) y tener su API key
   - 🔴 Crear Upstash Redis y copiar credenciales
   - 🔴 `join` desde tu WhatsApp al sandbox `+14155238886`
   - 🔴 Faucet devnet a sponsor wallet `7yLRNcZkbjQfu4xsyvewpVAcgFd4fD8pBLKahRFT64bS`

2. **Yo (cuando tengas lo de arriba):**
   - Adaptar `packages/config/src/env.ts` con Twilio API Keys + LLM provider correcto
   - Verificar Twilio API Key con curl real
   - Verificar Moonshot/Groq con curl real
   - Esperar merge de `feat/kimi-agent` y `feat/anchor-tanda-flow`
   - Hito 1 (echo bot via ngrok) → Hito 2 (Kimi text) → Hito 3 (tool use)

3. **Coordinación multi-agente:**
   - PR review queue: tanda-flow, kimi-agent, drizzle-schemas, upstash-cache
   - Merge order para evitar conflicts: env additions primero, luego features
