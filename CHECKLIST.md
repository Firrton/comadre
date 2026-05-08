# Comadre — Checklist MVP Hackathon

> Marca cada item como `- [x]` cuando esté hecho. Items con 🔴 son blockers críticos.

---

## Fase 0 — Setup (Día 1)

### Repo & tooling
- [x] Crear repo público en GitHub
- [x] Estructura de monorepo (apps/ + packages/)
- [x] `.gitignore`, `.editorconfig`, `LICENSE` (MIT)
- [x] `package.json` raíz + workspaces + Turbo
- [x] `tsconfig.base.json`
- [x] CI workflow (lint + typecheck + anchor build)
- [ ] Invitar collaborators al repo (GitHub Settings → Collaborators)
- [ ] Branch protection en `main` (require PR + 1 review)

### Cuentas externas
- [ ] 🔴 Helius — crear API key (devnet + mainnet)
- [ ] 🔴 Privy — crear app, configurar Solana network, obtener app_id + secret
- [ ] 🔴 Supabase — crear proyecto, obtener DATABASE_URL
- [ ] 🔴 Upstash — crear Redis, obtener REST URL + token
- [ ] 🔴 Anthropic — API key (modelo `claude-sonnet-4-6`)
- [ ] 🔴 Sumsub — sandbox account, app token + secret
- [ ] 🔴 Meta for Developers — app + WhatsApp Business + phone number ID + access token
- [ ] ElevenLabs — API key (Fase 2)
- [ ] Railway — crear project, conectar GitHub
- [ ] Vercel — conectar repo a apps/web
- [ ] Sentry — crear proyectos (web, mobile, backends)
- [ ] Better Stack — crear log source

### Wallets de Solana
- [ ] Generar `fee_payer.json` + airdrop devnet 2 SOL
- [ ] Generar `crank_authority.json` + airdrop 1 SOL
- [ ] Generar `kyc_oracle.json` + airdrop 0.5 SOL
- [ ] Generar `admin.json` + airdrop 0.5 SOL
- [ ] Convertir a base58 y guardar en Doppler/Infisical (NUNCA en git)

### Local dev environment
- [ ] Bun ≥ 1.2.0 instalado
- [ ] Rust + Solana CLI 2.0+ instalados
- [ ] Anchor 0.31 vía `avm`
- [ ] `bun install` exitoso en raíz
- [ ] `cp .env.example .env.local` + llenar
- [ ] `docker run` Postgres local OR usar Supabase remoto

---

## Fase 1 — Smart Contract (Día 2-5) 🔴 RUTA CRÍTICA

### `packages/anchor-program/`

#### Setup base
- [x] `Anchor.toml` configurado
- [x] `Cargo.toml` workspace + program
- [x] `lib.rs` con declaración de módulos
- [x] `constants.rs`, `errors.rs`, `events.rs`
- [x] State accounts (UserProfile, Tanda, Member, Dispute, Loan, Badge, Config)
- [x] Esqueleto de instructions (TODO handlers)

#### Instruction handlers
- [ ] 🔴 `init_user_profile` — implementación + test
- [ ] `update_kyc_tier` — validar oracle signer + emit event
- [ ] 🔴 `init_config` — singleton, deployer-only
- [ ] 🔴 `create_tanda` — crear Tanda PDA + Vault ATA via `init`
- [ ] 🔴 `join_tanda` — crear Member PDA, transfer stake → vault
- [ ] 🔴 `start_tanda` — solo creator, validar member_current == member_target
- [ ] 🔴 `contribute` — transfer USDC user ATA → vault, increment counter
- [ ] 🔴 `payout` — vault → beneficiary, advance turn, validar contribuciones
- [ ] `slash_defaulter` — validar default, slash stake, mark inactive
- [ ] `complete_tanda` — return stakes, mint badges, mark Completed
- [ ] `open_dispute` — pause tanda, create Dispute account
- [ ] `vote_dispute` — solo members, PDA-enforced unique
- [ ] `resolve_dispute` — apply majority, unpause o cancel
- [ ] `pause` / `unpause` — admin kill switch

#### Loan flow (Fase 2 — si hay tiempo)
- [ ] `request_loan`
- [ ] `cosign_loan`
- [ ] `disburse_loan`
- [ ] `repay_loan`
- [ ] `default_loan`

#### Tests TS (`tests/*.spec.ts`)
- [ ] 🔴 `tanda.spec.ts` — happy path: create → 5 join → 5 contribute → 5 payout → complete
- [ ] `tanda.spec.ts` — slash defaulter
- [ ] `dispute.spec.ts` — open → vote → resolve (continue)
- [ ] `dispute.spec.ts` — open → vote → resolve (cancel)
- [ ] `helpers.ts` — provider, USDC mock mint, airdrop

#### Deploy
- [ ] `anchor build` exitoso
- [ ] `anchor deploy --provider.cluster devnet`
- [ ] Update `declare_id!` con program_id real
- [ ] `anchor idl init` (subir IDL on-chain)
- [ ] `bun run codegen:client` (generar TS client)
- [ ] Verificar program en explorer.solana.com (devnet)

---

## Fase 2 — Backend (Día 3-8, paralelo a contracts)

### `packages/db/`
- [ ] 🔴 Definir Drizzle schema (users, tandas, members, disputes, dispute_votes, loans, loan_cosigners, badges, conversations, idempotency_keys, ramps, kyc_sessions)
- [ ] `drizzle-kit generate` — crear primera migration
- [ ] `drizzle-kit migrate` — aplicar a Supabase
- [ ] `client.ts` — connection pool singleton

### `packages/types/`
- [ ] 🔴 Zod schemas: CreateTandaInput, JoinTandaInput, ContributeInput, OpenDisputeInput, VoteDisputeInput
- [ ] API responses: TandaResponse, MemberResponse, UserProfileResponse
- [ ] Webhook payloads: SumsubEvent, MetaWebhookEvent, HeliusWebhookEvent

### `packages/config/`
- [ ] 🔴 Env schema con Zod (todos los vars de `.env.example`)
- [ ] Helper `loadEnv()` con fail-fast

### `packages/cache/`
- [ ] 🔴 Upstash Redis client singleton
- [ ] Idempotency cache helper (24h TTL)
- [ ] Rate limit helper con `@upstash/ratelimit`
- [ ] WhatsApp 24h window helper

### `packages/solana/`
- [ ] 🔴 `feePayer.ts` — load wallets desde env
- [ ] 🔴 `txBuilder.ts` — wrap Anchor instructions, return base64 unsigned tx
- [ ] `retry.ts` — submission con priority fees + blockhash refresh

### `packages/anchor-client/`
- [ ] 🔴 Run codegen tras deploy
- [ ] PDA derivation helpers (`deriveUserPda`, `deriveTandaPda`, etc.)
- [ ] Typed `Program<Comadre>` export

### `apps/api/`
- [ ] 🔴 Auth middleware (Privy JWT verify)
- [ ] 🔴 Idempotency middleware
- [ ] Rate limit middleware (per-user)
- [ ] Logger middleware (Pino + req_id)
- [ ] Error handler (Sentry capture)
- [ ] 🔴 `POST /api/v1/users/init` — armar tx + return unsigned
- [ ] `POST /api/v1/users/:wallet/confirm` — verificar signature confirmada
- [ ] 🔴 `POST /api/v1/tandas` (create) — return unsigned tx
- [ ] `GET /api/v1/tandas/:id` — full detail con members
- [ ] `GET /api/v1/tandas` — list mis tandas
- [ ] 🔴 `POST /api/v1/tandas/:id/join`
- [ ] `POST /api/v1/tandas/:id/start`
- [ ] 🔴 `POST /api/v1/tandas/:id/contribute`
- [ ] `POST /api/v1/tandas/:id/disputes`
- [ ] `POST /api/v1/disputes/:id/vote`
- [ ] `POST /api/v1/kyc/session` — Sumsub access token init
- [ ] `POST /webhooks/sumsub` — verify HMAC + update tier on-chain
- [ ] `POST /webhooks/privy` — wallet linking events
- [ ] `POST /api/v1/onramp/quote` — mock
- [ ] `POST /api/v1/offramp/quote` — mock
- [ ] Health check `/health`

### `apps/indexer/`
- [ ] 🔴 Helius webhook config (registrar via API)
- [ ] 🔴 Verify webhook auth header
- [ ] 🔴 Anchor `EventParser` setup
- [ ] 🔴 Handler para cada evento (TandaCreated, MemberJoined, ContributionMade, ...)
- [ ] Upsert helpers (idempotente — si el evento ya está procesado, skip)
- [ ] `POST /reindex` — admin endpoint
- [ ] Pub/sub Redis para notificar cambios en tiempo real

### `apps/cron/`
- [ ] 🔴 `payoutCrank` — cada 5 min
- [ ] `disputeResolveCrank` — cada hora
- [ ] `reminderJob` — diario 9am — manda WA + push
- [ ] `kycRefreshJob` — diario 4am

### `apps/whatsapp/`
- [ ] 🔴 GET `/webhook` — Meta verification handshake
- [ ] 🔴 POST `/webhook` — verify `X-Hub-Signature-256` con `META_APP_SECRET`
- [ ] 🔴 Parser de eventos (text inicialmente; audio en Fase 2)
- [ ] 🔴 Resolve phone → user via Supabase
- [ ] 🔴 Onboarding flow para phones no registrados
- [ ] Redis state `wa:lastinbound:{phone}` (24h window)
- [ ] POST `/reply` (internal) — envía vía Graph API
- [ ] Templates aprobados con Meta:
  - [ ] `tanda_recordatorio_v1`
  - [ ] `tanda_payout_listo_v1`
  - [ ] `disputa_abierta_v1`
  - [ ] `kyc_pendiente_v1`

### `apps/agent/`
- [ ] 🔴 System prompt "tía cariñosa firme con la plata" + reglas de seguridad
- [ ] 🔴 Tool registry import desde `@comadre/agent-tools`
- [ ] 🔴 `POST /process` — Claude tool-use loop
- [ ] Conversation state load/save (Postgres jsonb)
- [ ] Confirmación humana para tx > $10 USDC
- [ ] Rate limit por user (30 tool calls/hora)

### `packages/agent-tools/`
- [ ] 🔴 `consultar_perfil` (read-only)
- [ ] 🔴 `crear_tanda`
- [ ] 🔴 `unirse_tanda`
- [ ] 🔴 `consultar_tanda`
- [ ] 🔴 `aportar_turno`
- [ ] `abrir_disputa`
- [ ] `votar_disputa`
- [ ] `solicitar_kyc`
- [ ] `iniciar_onramp`
- [ ] `solicitar_offramp` (mock)

---

## Fase 3 — Mobile (Día 5-10)

### `apps/mobile/`
- [ ] 🔴 Expo SDK 52 init + TS strict
- [ ] 🔴 Privy provider + embedded wallet flow
- [ ] 🔴 MWA provider (Solana Mobile SDK)
- [ ] 🔴 Login pantalla (`(auth)/login.tsx`) — phone OTP via Privy
- [ ] 🔴 Home (`(app)/index.tsx`) — lista mis tandas
- [ ] 🔴 Crear tanda (`(app)/tanda/new.tsx`)
- [ ] 🔴 Detalle tanda (`(app)/tanda/[id].tsx`)
- [ ] Join tanda via deep link (`comadre://join/:id`)
- [ ] Contribuir (modal desde detalle)
- [ ] KYC pantalla (`(app)/kyc.tsx`) — WebView con Sumsub WebSDK
- [ ] Profile pantalla (`(app)/profile.tsx`)
- [ ] React Query setup para API calls
- [ ] SecureStore para tokens
- [ ] dApp Store APK build con EAS
- [ ] Submit a Solana dApp Store (review 3-5 días — empezar día 1!)

### Voice (Fase 2)
- [ ] ElevenLabs Conv AI agent setup
- [ ] React Native SDK integration
- [ ] Push-to-talk UI
- [ ] Voice authentication PIN/biometric

---

## Fase 4 — Web (Día 7-10)

### `apps/web/`
- [ ] Landing page con waitlist
- [ ] `/admin` route con Privy gate
- [ ] Tabla de tandas activas
- [ ] Tabla de KYC pendientes
- [ ] Tabla de disputas abiertas
- [ ] Botón pause programa (con confirmación 2FA)

---

## Fase 5 — Testing E2E (Día 10-12)

- [ ] 🔴 Flow E2E mobile: login → init profile → create tanda → invite → contribute → payout
- [ ] 🔴 Flow E2E WhatsApp: phone msg → KYC → join tanda → contribute via signing link
- [ ] Stress test: 10 tandas paralelas, payouts simultáneos
- [ ] Idempotency test: duplicate webhook, no doble efecto
- [ ] Regression: pause → tx fail correctamente

---

## Fase 6 — Demo & Pitch (Día 12-14)

- [ ] 🔴 Video demo 3 min (script + grabación + edición)
- [ ] 🔴 README con quickstart claro
- [ ] 🔴 Pitch deck (8-10 slides)
- [ ] Landing en comadre.lat con waitlist
- [ ] Submit a Colosseum hackathon
- [ ] Submit a Solana Mobile track
- [ ] Submit a ElevenLabs track (si voice está listo)
- [ ] Twitter/X thread anuncio

---

## Riesgos identificados (mitigación pendiente)

- [ ] **Meta WA template approval** — comenzar día 1, review 2-5 días
- [ ] **Solana dApp Store review** — comenzar día 1, review 3-5 días
- [ ] **Idempotencia E2E** — diseñar antes de escribir indexer
- [ ] **Audit de program** — post-hackathon (mencionar en pitch)
- [ ] **WhatsApp cost projection** — presupuestar $0.05/conversación

---

## Definición de "Done" para MVP

- [ ] Demo en vivo: usuario crea tanda en Seeker, otro usuario se une vía WhatsApp link, ambos contribuyen, payout ejecuta automáticamente.
- [ ] Devnet program desplegado y verificado.
- [ ] CI verde.
- [ ] README con instrucciones para que un juez de Colosseum reproduzca el demo.
- [ ] Video demo público.
