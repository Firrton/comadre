# Comadre — Checklist MVP Hackathon

> Última actualización: 2026-05-08
> Convenciones: 🔴 blocker crítico · 🟡 en progreso · ✅ hecho · ⏳ esperando
> Marca cada item como `- [x]` cuando esté hecho.

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
| `apps/whatsapp` (Twilio) | ✅ | Webhook + reply, typecheck + tests pasan localmente |
| `apps/agent` (Kimi) | 🟡 | En construcción en worktree `/Users/firrton/comadre-kimi` |
| APIs externas | 🟡 | Helius ✓, Privy ✓, Twilio ✓ (con master token, no API key todavía); Kimi/Upstash pendientes |
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
- Yield mockeado en MVP (Kamino post-hackathon)
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
- [ ] Sumsub — sandbox account (Fase 2)
- [ ] Sentry — proyectos web/mobile/backend (post-MVP)
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
- [ ] 🔴 `INTERNAL_HMAC_SECRET` — generar con `openssl rand -hex 32`
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
- [x] Tests pasan (3/3)
- [x] Typecheck pasa
- [ ] **Migrar a Twilio API Key** (SK...) en lugar de master Auth Token
- [ ] Templates aprobados con Twilio:
  - [ ] `tanda_recordatorio`
  - [ ] `tanda_payout_listo`
  - [ ] `kyc_pendiente`
- [ ] Deploy a Railway con webhook URL pública

### `apps/agent` 🟡 Kimi K2 via Moonshot/Groq (en progreso — worktree `comadre-kimi`)
- [ ] 🔴 **Decidir provider**: Moonshot directo (más barato) vs Groq (más rápido)
- [ ] Cliente OpenAI SDK con baseURL custom según provider
- [ ] `POST /process` — recibe `{from, body, conversationKey}`
- [ ] Tool use loop (max 5 iterations)
- [ ] System prompt "tía cariñosa LATAM" en español
- [ ] Conversation state en Redis con TTL 24h
- [ ] Mock tool `consultar_perfil` para hito 3
- [ ] Tests (health, validación, executeTool)
- [ ] Typecheck

### `packages/agent-tools` 🟡
- [ ] Estructura registry de tools
- [ ] `consultar_perfil` (mock por ahora)
- [ ] `crear_tanda`, `unirse_tanda`, `consultar_tanda` (post-MVP)
- [ ] `aportar_turno`
- [ ] Tools NUNCA firman tx — solo llaman API service

### `apps/api` ⏳ (no iniciado)
- [ ] Hono port 3001
- [ ] Auth middleware (Privy JWT verify)
- [ ] Idempotency middleware
- [ ] Rate limit middleware
- [ ] Endpoints: `/users`, `/tandas`, `/members`, `/disputes`, `/kyc`, `/onramp`, `/offramp`
- [ ] Webhook handlers: `/webhooks/sumsub`, `/webhooks/privy`

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

## 🚨 Riesgos detectados (mitigación pendiente)

- 🔴 **Twilio Auth Token filtrado** — `e37fc5...d9d` quedó en transcript del chat. **ROTAR INMEDIATAMENTE**
- 🔴 **Sponsor wallet con 0 SOL** — necesita airdrop devnet (rate-limited, usar faucet web)
- 🔴 **Sandbox no joined** — sin `join <código>`, mensajes nunca llegan
- 🟡 **Multi-agente paralelo** — varios agentes haciendo PRs distintos. Coordinación de merges + branch hygiene
- 🟡 **Twilio template approval** — `HX350d...` ya OK, pero los nuevos para Comadre necesitan aprobación 24-48h
- 🟡 **dApp Store review** — 3-5 días, empezar día 1 del sprint mobile
- 🟡 **Idempotencia E2E** — diseñada en `packages/cache`, falta wiring en endpoints
- 🟡 **Kimi provider TBD** — Moonshot directo vs Groq pendiente decisión final
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
