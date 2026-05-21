# Comadre — Backend technical reference

> **Hub navegacional** del backend de Comadre. Si sos nuevo en el proyecto (humano o agente IA), leé las primeras dos secciones (5 minutos) y de ahí navegá al detalle que necesites.

## TOC

1. [¿Qué es Comadre?](#qué-es-comadre) — 30 segundos
2. [Onboarding rápido (5 min)](#onboarding-rápido-5-min) — leer este doc + uno de detalle
3. [Stack overview](#stack-overview) — tech decisions cerradas
4. [Service map](#service-map) — qué servicio hace qué
5. [Status del proyecto](#status-del-proyecto) — qué está mergeado, qué falta
6. [Convenciones del repo](#convenciones-del-repo)
7. [Sub-docs especializados](#sub-docs-especializados)
8. [Cómo contribuir](#cómo-contribuir)

---

## ¿Qué es Comadre?

**Comadre** es un agente de WhatsApp que ayuda a familias y comunidades en LATAM a manejar plata en USDC sobre Monad, con cuatro features core:

1. **Phone-to-phone USDC transfers** — manda 10 USDC a un número de teléfono (registrado o no — onboarding implícito).
2. **Tandas** — grupos rotativos de ahorro on-chain (3-20 personas aportan, cada turno una se lleva el pot).
3. **Guardadito USDC** — ahorro con bóveda (planeado para Phase 2, sobre contratos Monad).
4. **Crédito comunitario** — préstamos con cosigners (Phase 2).

El bot vive en WhatsApp; la inteligencia es **Kimi K2** (Moonshot/Groq) con tool-use; la plata es **USDC en Monad** (testnet en dev, mainnet pendiente del launch); las **user wallets** son embedded **Privy** + Kernel v3.1 smart wallet (ERC-4337); el **session key** que firma operaciones del agente vive en **Turnkey HSM** (sub-organization por usuario).

### Pitch de mercado
- Remesas LATAM: $150B/año, fees 3-7%
- Comadre: 0.5% (sponsorea gas con `fee_payer` backend)
- Acceso vía WhatsApp (~85% penetración LATAM) sin instalar app

---

## Onboarding rápido (5 min)

**Setup local** (10 min reales si tenés todas las cuentas externas):
```bash
git clone https://github.com/Firrton/comadre.git
cd comadre
bun install
cp .env.example .env.local
# llenar las creds de tu lado — ver docs/DEVELOPMENT.md
bun run dev
```

**El sistema arranca 4 servicios backend**:
- `apps/api` :3001 — REST API (Privy JWT auth, builds + relays Monad UserOps)
- `apps/whatsapp` :3002 — Twilio webhook + reply
- `apps/agent` :3003 — Kimi tool-use loop
- `apps/cron` :3005 — jobs scheduled (dispute, reminder, kycRefresh)

**Flujo end-to-end**: usuario manda `"manda 10 USDC al +52..."` por WhatsApp → Twilio → `apps/whatsapp` → `apps/agent` (Kimi tool_call `enviar_plata`) → `apps/api` `/transfers-monad` (decodifica calldata USDC, valida allowlist, llama a `signMonadTransfer` → Turnkey firma con la session key del usuario → Pimlico bundler submite el UserOp → tx en Monad) → `✅ tx: monadscan/...`. Ver `docs/FLOWS.md` para el sequence diagram completo.

**Para crear/modificar algo, decidí qué tocás**:
- ¿Lógica on-chain nueva en Comadre.sol? → `packages/monad-contracts/src/Comadre.sol`. Después `forge build && forge test`.
- ¿Nuevo endpoint REST? → `apps/api/src/routes/X.ts` + mount en `server.ts`.
- ¿Nueva tool del agente? → `packages/agent-tools/src/tools.ts` (append a `ALL_TOOLS` y `TOOL_EXECUTORS`).
- ¿Schema DB nuevo? → `packages/db/src/schema.ts` + nueva migration en `packages/db/drizzle/`.
- ¿Validación shared? → `packages/types/src/{inputs,responses}.ts`.
- ¿Nueva operación que requiere firma del agente? → `packages/wallet-infra/src/turnkey/` (cliente Turnkey) + `apps/api/src/lib/monadSessionSigner.ts`.

**Si querés más profundidad** sobre algún componente, andá al sub-doc:

| Querés saber... | Doc |
|---|---|
| Qué hay en cada package y cómo se usa | [PACKAGES.md](./PACKAGES.md) |
| Cómo está estructurado cada servicio | [APPS.md](./APPS.md) |
| Cómo fluyen los datos end-to-end (con diagramas) | [FLOWS.md](./FLOWS.md) |
| Cómo deployar / inicializar el program / mintear test USDC | [RUNBOOK.md](./RUNBOOK.md) |
| Esquema general de la arquitectura | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| Qué guarda Postgres + Solana | [DATA_MODEL.md](./DATA_MODEL.md) |
| Term que no sabés (PDA, ATA, slash, etc.) | [GLOSSARY.md](./GLOSSARY.md) |
| Setup local detallado, env vars, troubleshooting | [DEVELOPMENT.md](./DEVELOPMENT.md) |
| Estado del MVP, qué falta | [CHECKLIST.md](./CHECKLIST.md) |
| Qué servicios tiene corriendo otro agente, coordinación | [RUNNING.md](./RUNNING.md) |

---

## Stack overview

| Capa | Tech | Versión |
|---|---|---|
| Smart contract | Solidity + Foundry | 0.8.28 / Forge 1.5+ |
| Chain | Monad | testnet (mainnet pendiente del launch) |
| Account abstraction | ZeroDev Kernel v3.1 + ERC-4337 | — |
| Bundler | Pimlico | — |
| Backend runtime | Bun | 1.2+ |
| Web framework | Hono | 4.x |
| Lenguaje | TypeScript | 5.7+ strict + `verbatimModuleSyntax` + `noUncheckedIndexedAccess` |
| ORM | Drizzle | 0.36+ |
| DB | Postgres | 15 (Supabase) |
| Cache | Upstash Redis | REST |
| User wallet | Privy embedded wallet (EVM) | 1.32.5+ |
| Session key custody | Turnkey HSM | sub-organization por usuario |
| WhatsApp | Twilio | sandbox `whatsapp:+14155238886` + Twilio Verify para OTP |
| KYC | Sumsub WebSDK + REST API | level `id-and-liveness` |
| LLM | Kimi K2 vía Moonshot directo o Groq | OpenAI-compatible SDK |
| Validation | Zod | 3.23+ |
| Logging | Pino | 9+ |
| Test runner | Bun test (TS) + Forge test (Solidity) | — |
| Observabilidad | Sentry (`@sentry/bun`) | inicializado en `apps/api`, `apps/agent`, `apps/whatsapp` si `SENTRY_DSN` está seteado |

### Decisiones técnicas cerradas

- **Chain única**: Monad (Solana fue eliminado en Phase 1)
- **Token único**: USDC (no multi-token en Phase 1)
- **Custodia**: Privy custodia owner key + Turnkey custodia session key — backend nunca tiene material privado en memory
- **Tx signing**: Turnkey API (no más AWS KMS envelope encryption)
- **Stake-to-join (tandas)**: 1× contribution
- **PayoutOrder MVP**: solo `JoinOrder`
- **Crank híbrido**: `apps/cron` interno + callable por anyone (resiliencia)
- **Lock model en transfers diferidos**: earmark off-chain (no on-chain escrow PDA)
- **Gas**: usuarios pagan en MON (paymaster sponsorship vía Pimlico planeado para Phase 2)

---

## Service map

```
┌───────────────────────────────────────────────────────────────────────┐
│                       Twilio WhatsApp Sandbox                          │
└─────────────────────────────────┬─────────────────────────────────────┘
                                  │ webhook (HMAC X-Twilio-Signature)
                                  ▼
                    ┌──────────────────────────┐
                    │  apps/whatsapp :3002     │
                    │  Hono + Twilio SDK       │
                    │  - /webhook (inbound)    │
                    │  - /reply (HMAC outbound)│
                    └────────┬─────────────────┘
                             │ HTTP
                             ▼
                    ┌──────────────────────────┐
                    │  apps/agent :3003        │
                    │  Hono + OpenAI SDK→Kimi  │
                    │  - /process              │
                    │  - tool-use loop max 5x  │
                    │  - conv state Redis 24h  │
                    └────────┬─────────────────┘
                             │ HMAC X-Internal-*
                             ▼
                    ┌──────────────────────────┐         ┌──────────────────┐
                    │  apps/api :3001          │◄───────►│  apps/cron :3005 │
                    │  Hono + Privy + Drizzle  │  HMAC   │  node-cron jobs  │
                    │  - REST routers          │         │  - dispute       │
                    │  - signMonadTransfer →   │         │  - reminder      │
                    │    Turnkey API           │         │  - kycRefresh    │
                    │  - idempotency Redis     │         │                  │
                    └─┬───────────┬────────────┘         └──────────────────┘
                      │           │
            ┌─────────┘           └─────────┐
            ▼                               ▼
   ┌──────────────┐              ┌────────────────────┐
   │  Postgres    │              │  Monad testnet     │
   │  (Supabase)  │              │  + Pimlico bundler │
   │  ~18 tables  │              │  + Privy embedded  │
   └──────────────┘              │     EVM wallets    │
                                 │  + Kernel v3.1     │
                                 │  + Turnkey HSM     │
                                 │    (session keys)  │
                                 └────────────────────┘
```

Para más detalle de cada servicio (puerto, middlewares, routers, env vars consumidas) ver [APPS.md](./APPS.md).

---

## Status del proyecto

**21 PRs mergeados a `main`** al cierre de Sprint 1+ (Phase 8 actual = doc técnica).

### Lo que está completo
- ✅ Anchor program completo: 15 instructions, 9 state structs, 14 events, ~28 errors, 10 PDA seeds. Deployado a devnet (`BfVXncFhJdSsDciLx7UzVjFbEBw1EtcnJCsYSRis54Sh`).
- ✅ Packages base: `@comadre/{config, types, db, cache, anchor-client, solana, agent-tools}`. 19 tools en el registry.
- ✅ `apps/api`: 8 routers, 6 middlewares (CORS, auth Privy, idempotency, rate limit, Pino logger, error handler), 4 lib helpers (phoneLookup, kycLimits, usdcTransfer, privySigner).
- ✅ `apps/whatsapp`: Twilio webhook + reply HMAC. Rate limiting (60 req/min por phone). HMAC-SHA256 outbound a `apps/agent`.
- ✅ `apps/agent`: tool-use loop (max 5 iters) con onboarding via Privy y contexto Guardadito. HMAC-SHA256 inbound verificado con ventana anti-replay de 5 min. Rate limiting (30 tool calls/hora por conversación).
- ✅ Sentry inicializado en los 3 servicios principales (`apps/api`, `apps/agent`, `apps/whatsapp`) con trace sampling 10% prod / 100% dev.
- ✅ Guardadito v1: savings API, mock adapter, Kamino boundary, nudges por Twilio y detección Helius de ingresos USDC.
- ✅ Guardadito Neverland: adaptador Neverland (Aave V3 en Monad) conectado. `YIELD_STRATEGY_PROVIDER=neverland` activa el path on-chain: `depositToNeverland`, `withdrawFromNeverland` con fee en yield, `readNeverlandPosition`. Schema DB extendido con `principal_withdrawn_micro_usdc` y enum `neverland`. Session keys ahora incluyen políticas de Neverland cuando `NEVERLAND_POOL_ADDRESS` y `COMADRE_FEE_WALLET` están configurados.
- ✅ `apps/cron`: 4 jobs scheduled.
- ✅ Repo tidy completo (PR #21): apps con `lib/` + `__tests__/`, docs consolidados.

### Lo que falta para demo end-to-end

| Item | Owner | Bloqueante? |
|---|---|---|
| Privy embedded wallets habilitados en dashboard | Humano | 🔴 sí — sin esto `signTransaction` falla |
| Moonshot API key real (reemplazar stub) | Humano | 🔴 sí |
| Upstash Redis URL+TOKEN reales | Humano | 🔴 sí — sin esto agent no recuerda contexto |
| Supabase `DATABASE_URL` real | Humano | 🔴 sí — sin DB no hay persistencia |
| Twilio API Key `SK...` (rotar Auth Token filtrado) | Humano | 🔴 sí — outbound falla con 401 |
| `fee_payer` con ~1 SOL devnet | Humano | 🔴 sí — el deploy quemó 3.48 SOL |
| USDC devnet en wallet de prueba | Humano | sí para probar — usar https://faucet.circle.com |
| ngrok/cloudflared tunnel up | Humano | sí para Twilio sandbox |
| `init_program_config` script | Yo (post-deploy) | 🟡 nice-to-have (KYC fallback hardcoded) |
| `apps/indexer` (Helius EventParser) | Yo (post-MVP) | 🟢 no — P2P no usa events Anchor |

Para tracking detallado ver [CHECKLIST.md](./CHECKLIST.md).

---

## Convenciones del repo

### Estructura
```
/                              ← README, LICENSE, CONTRIBUTING, configs, .env.example
docs/                          ← este doc + sub-docs especializados
apps/                          ← servicios backend (5) + frontend disabled (2)
  api/      src/{routes,middlewares,lib,__tests__,server.ts,index.ts}
  cron/     src/{jobs,lib,__tests__,server.ts,index.ts}
  agent/    src/{lib,__tests__,agentLoop.ts,index.ts}
  whatsapp/ src/{lib,__tests__,index.ts}
  indexer/  src/index.ts                                          ← esqueleto
packages/                      ← libs compartidas (8)
  config, types, db, cache, anchor-client, solana, agent-tools, anchor-program
infra/
  railway.toml                                                    ← config Railway
scripts/
  codegen-client.sh, deploy-program.sh, seed-db.ts (TODO)
```

### Imports
- Cross-package: `import { x } from "@comadre/<package>"`
- Same-app: `import { y } from "./lib/y.js"` (`.js` requerido por ESM resolution)
- Tests: `import { z } from "../foo.js"` desde `src/__tests__/`

### Naming
- TS files: camelCase (`phoneLookup.ts`, `kycLimits.ts`, `txBuilder.ts`)
- Rust files: snake_case (`update_kyc.rs`, `init_config.rs`)
- Zod schemas: `PascalCase` ending en `Input` o `Response` (`CreateTandaInput`)
- Drizzle tables: snake_case (`transfer_status_enum`, `dispute_votes`)
- Branches: `feat/<scope>`, `fix/<scope>`, `chore/<scope>`, `docs/<scope>`

### Commits
- Conventional commits: `feat(api): ...`, `fix(anchor): ...`, `chore(repo): ...`
- **NO `Co-Authored-By`** (regla del repo)
- Cuerpo del mensaje en bullets explicando qué cambió y por qué

### Env vars
- Validadas con Zod en `packages/config/src/env.ts`. Eager loading (fail-fast en boot).
- `NODE_ENV !== "production"` activa dev-mode bypasses (`X-Dev-Wallet` header en `apps/api auth`).
- Para ver el listado completo: `cat .env.example`.

### Tests
- Convención `src/__tests__/<name>.test.ts` para todos los TS packages/apps.
- Anchor sigue su propia convención: `packages/anchor-program/tests/*.spec.ts`.
- `bunfig.toml` por package indica `envFile = ".env.test"` con stubs.

---

## Sub-docs especializados

| Doc | Audiencia | Cuándo usar |
|---|---|---|
| [PACKAGES.md](./PACKAGES.md) | dev escribiendo código | querés saber qué exporta `@comadre/X` y cómo usarlo |
| [APPS.md](./APPS.md) | dev tocando un servicio | querés saber middleware order, env vars, routers de `apps/X` |
| [FLOWS.md](./FLOWS.md) | arquitecto / dev nuevo | querés ver el sequence completo de un user journey con Mermaid |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | dev nuevo / pitch / audit | overview de stack + service map |
| [DATA_MODEL.md](./DATA_MODEL.md) | dev tocando schemas | ver tablas Postgres + on-chain accounts + decisiones DB |
| [DEVELOPMENT.md](./DEVELOPMENT.md) | dev haciendo setup local | env vars + troubleshooting + commands |
| [RUNBOOK.md](./RUNBOOK.md) | DevOps / deploy | deploy a devnet, init_config, mint test USDC |
| [GLOSSARY.md](./GLOSSARY.md) | cualquiera | encontraste un término que no conocés |
| [CHECKLIST.md](./CHECKLIST.md) | PM / lead | progreso del MVP, qué falta |
| [RUNNING.md](./RUNNING.md) | agente paralelo | qué servicios corren localmente, qué archivos tocó qué agente |

---

## Cómo contribuir

### Workflow
1. Branch desde `main`: `git checkout -b feat/<scope>`
2. Implementar + tests (`bun run typecheck`, `bun run test`)
3. Conventional commit message
4. PR contra `main` con descripción + test plan
5. Review (humano o `engineering:code-review` skill auto)
6. Merge tras CI verde

### Coordinación entre agentes IA
- **Antes de tocar un archivo**, verificá [RUNNING.md](./RUNNING.md) — puede haber otro agente trabajando ahí
- Branches en flight están listadas en RUNNING.md con su scope
- Conflicts en `apps/agent/src/` son comunes — coordinar antes
- `@comadre/config/src/env.ts` y `packages/db/src/schema.ts` son hot zones (cualquier feature nuevo los toca)

### Tech-debt conocido (follow-up post-MVP)
- `phoneNormalize.ts` duplicado entre `apps/agent` y `apps/api/lib` → mover a `@comadre/cache`
- `logger.ts` duplicado entre `apps/api/middlewares` y `apps/cron/lib` → crear `@comadre/logger` package
- `apps/api/lib/stubs.ts` (`makeTxStub`) usado en routes/users/tandas/disputes → reemplazar con tx-build real
- `INITIAL_DEPLOYER` placeholder en `packages/anchor-program/constants.rs` → setear pre-mainnet
- `Cargo.lock` tiene pre-edition2024 pinning (blake3, indexmap, etc.) → quitar al upgrade Solana CLI 2.3+
- `bun-types` typecheck issue en root tsconfig → fix antes de meter más packages
- VRF para `Random` payout order en Anchor program
- `claim_stake` instruction (devolver stakes post-Completed)

---

## Licencia

MIT — ver `LICENSE` en root.

## Contacto

Repo: https://github.com/Firrton/comadre

Para issues / discusiones técnicas, abrí un issue en GitHub. Para coordinación inter-agente, usá [RUNNING.md](./RUNNING.md).
