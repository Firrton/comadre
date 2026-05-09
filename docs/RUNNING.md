# Comadre — Running services & coordination

> Status board para coordinar entre agentes paralelos. **Última actualización: 2026-05-08**
> 
> Este archivo documenta qué procesos están corriendo localmente, qué archivos tocó qué agente, y qué NO debe tocar cada uno para evitar conflictos.

---

## 🟢 Servicios actualmente corriendo (local dev)

| Servicio | Puerto | Tech | Comando para arrancar |
|---|---|---|---|
| `apps/agent` | `3003` | Bun + Hono + OpenAI SDK → Moonshot Kimi | `cd apps/agent && bun --env-file=../../.env run --hot src/index.ts` |
| `apps/whatsapp` | `3002` | Bun + Hono + Twilio SDK | `cd apps/whatsapp && bun --env-file=../../.env run --hot src/index.ts` |
| Cloudflare Tunnel | — | `cloudflared` | `cloudflared tunnel --url http://localhost:3002 --no-autoupdate` |

### URLs activas

```
local:  http://localhost:3002 (whatsapp)  http://localhost:3003 (agent)
public: https://<random>.trycloudflare.com → :3002 (cambia cada vez que arranca cloudflared)
```

> ⚠️ La URL pública de cloudflared **cambia en cada reinicio**. Cuando cambies, hay que:
> 1. Update `WA_URL=` en `.env`
> 2. Restart `apps/whatsapp` (porque Bun lee env al boot, no en hot reload)
> 3. Update webhook en Twilio Sandbox settings

### Healthchecks

```bash
curl http://localhost:3002/health   # {"ok":true,"service":"whatsapp"}
curl http://localhost:3003/health   # {"ok":true,"service":"agent"}
curl <CLOUDFLARED_URL>/health       # debe pasar al :3002
```

---

## 🔌 Flujo de un mensaje WhatsApp

```
📱 User:  "hola comadre"
   ↓
📲 Twilio Sandbox (whatsapp:+14155238886)
   ↓ POST x-www-form-urlencoded + X-Twilio-Signature
🌐 cloudflared tunnel → https://<random>.trycloudflare.com/webhook
   ↓
🟦 apps/whatsapp :3002
   ├─ Verifica X-Twilio-Signature con TWILIO_AUTH_TOKEN
   ├─ Parsea form: From, Body, MessageSid, ProfileName
   └─ Forward POST a ${AGENT_URL}/process con {from, body, conversationKey: from}
        ↓
🟪 apps/agent :3003
   ├─ Zod-valida body
   ├─ Carga history de Redis (key: agent:conv:{conversationKey})
   ├─ Llama Moonshot /chat/completions con system prompt + history
   ├─ Persiste history (TTL 24h, max 20 msgs)
   └─ Devuelve {reply: string}
        ↓
🟦 apps/whatsapp envía reply via Twilio Messages API
   └─ POST /Accounts/.../Messages.json con API Key SID/Secret
        ↓
📲 Twilio
        ↓
📱 User recibe respuesta
```

**Latencia esperada (modelo `moonshot-v1-32k`):** 1–3 segundos
**Latencia con `kimi-k2.5` o `kimi-k2.6` (reasoning):** 15–25 segundos

---

## 🌳 Branches activas (multi-agente — actualizar cuando algo merga)

| Branch | Estado | Owner aprox | Files que toca |
|---|---|---|---|
| `main` | base, protegida | — | merged PRs only |
| `feat/twilio-kimi-services` (PR #13) | ✅ funciona, esperando merge | yo | `apps/whatsapp/**`, `apps/agent/**`, `bun.lock` |
| `feat/anchor-tanda-flow` | ✅ mergeado (PR #7) | otro agente | — |
| `feat/anchor-user-admin-handlers` | ✅ mergeado (PR #3) | — | — |
| `feat/zod-schemas` | ✅ mergeado (PR #2) | — | — |
| `feat/env-loader` | ✅ mergeado (PR #1) | — | — |
| `feat/drizzle-schemas` | ✅ mergeado (PR #5) | — | — |
| `feat/upstash-cache` | ✅ mergeado (PR #6) | — | — |
| `chore/exclude-frontend-from-workspace` | ✅ mergeado (PR #4) | — | — |
| `docs/checklist-update` | ✅ mergeado (PR #9) | yo | `CHECKLIST.md` |

---

## 🚫 No tocar (mientras PR #13 esté abierto)

```
apps/whatsapp/**      → my PR #13
apps/agent/**         → my PR #13
bun.lock              → my PR #13 modifica
packages/config/src/env.ts → conflict-prone, coordinar antes de tocar
.env                  → archivo local, no se pushea
```

## 🟢 Libre para tocar (zonas independientes)

```
packages/anchor-program/**        ← contracts
packages/db/**                    ← Drizzle schemas
packages/types/**                 ← Zod shapes (additive es OK)
packages/cache/**                 ← Redis helpers
packages/agent-tools/**           ← tools del agente
apps/api/**                       ← REST API (skeleton en main)
apps/cron/**                      ← jobs (skeleton en main)
apps/indexer/**                   ← Helius webhooks (no implementado)
apps/web/**                       ← Next.js (no implementado)
apps/mobile/**                    ← Expo (no implementado)
docs/**                           ← documentación
infra/**                          ← Railway, Docker
scripts/**                        ← codegen, deploy
```

---

## 🔑 Env vars críticas (`/Users/firrton/comadre/.env`)

> El archivo `.env` está en `.gitignore` — NO se pushea. Cada dev tiene su copia local. `.env.example` SÍ está versionado.

### Setadas y funcionales

| Var | Para qué sirve |
|---|---|
| `TWILIO_ACCOUNT_SID` | `ACb729...` Account SID master |
| `TWILIO_AUTH_TOKEN` | Auth Token master, usado SOLO para webhook signature verify |
| `TWILIO_API_KEY_SID` | `SK...` API Key Main para outbound (REST send) |
| `TWILIO_API_KEY_SECRET` | Secret de la API Key |
| `TWILIO_WHATSAPP_FROM` | `whatsapp:+14155238886` (sandbox) |
| `MOONSHOT_API_KEY` | `sk-...` para Moonshot Kimi |
| `KIMI_MODEL` | `moonshot-v1-32k` (rápido, no-reasoning) |
| `LLM_PROVIDER` | `moonshot` (otra opción: `groq`) |
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | Redis state |
| `INTERNAL_HMAC_SECRET` | Auth interno service-to-service |
| `WA_URL` | URL pública del whatsapp service (cloudflared tunnel) |
| `AGENT_URL` | `http://localhost:3003` |
| `FEE_PAYER_SK` | Sponsor wallet `7yLRNcZ...` |
| `SOLANA_RPC_URL` | Helius devnet con API key embedded |
| `PRIVY_APP_ID` + `PRIVY_APP_SECRET` | Auth Privy |

### ⚠️ STUB values (placeholder para que Zod schema no falle)

Estas tienen valores fake — **NO funcionales**. Cualquier servicio que las use va a fallar:

```
COMADRE_PROGRAM_ID    = "11111111111111111111111111111111"  (no es program real)
CRANK_AUTHORITY_SK    = stub
KYC_ORACLE_SK         = stub
ADMIN_SK              = stub
PRIVY_VERIFICATION_KEY = stub
SUMSUB_*              = stub
ELEVENLABS_*          = stub
HELIUS_WEBHOOK_SECRET = stub
SENTRY_DSN            = stub URL
BETTER_STACK_TOKEN    = stub
```

**Cuando un servicio necesite estos vars de verdad** (ej: cuando se deploye el program Anchor, o se configure Sumsub), hay que pegar valores reales.

---

## 🐛 Bugs / quirks conocidos

### 1. `packages/config/src/env.ts` muy estricto
Marca como `required` (`min(1)`) muchas vars que en práctica son opcionales:
- `SENTRY_DSN`, `BETTER_STACK_TOKEN` — observability solo en prod
- `ELEVENLABS_*` — Fase 2
- `SUMSUB_*` — solo cuando Comadre haga onboarding KYC
- `HELIUS_WEBHOOK_SECRET` — solo en producción

**Fix recomendado:** marcar `.optional()` y agregar `superRefine` que las exija solo si el servicio que las usa está activo.

### 2. Bun no encuentra `.env` desde subdirs del monorepo
Bun busca `.env` en `process.cwd()`, no walking up. Por eso usamos `--env-file=../../.env` explícito en cada `bun run`.

**Workaround actual:** comando explícito.
**Fix recomendado:** symlink o load via `dotenv-cli` con find-up.

### 3. `@comadre/config` valida env en module init
Si vos importás `@comadre/config` con env mal seteado, el process crashea al boot. Esto rompe los tests de Bun que indirectamente importan config.

**Fix recomendado:** export `loadEnv()` lazy y NO ejecutar validación en `import`.

### 4. Cloudflared quick tunnel sin uptime SLA
La URL `*.trycloudflare.com` puede volverse inestable. Para producción hay que crear un tunnel nombrado en Cloudflare (gratis con account).

### 5. Twilio Sandbox unreliable internacional
Twilio avisa: "Sandbox may not reliably deliver international messages". Para producción → registrar número WhatsApp dedicado (proceso 2-7 días con Meta).

### 6. Modelos Kimi no son intercambiables sin testing
- `kimi-k2.5`, `kimi-k2.6` — reasoning models, 15-25s latency, **`temperature: 1` ONLY**
- `moonshot-v1-32k`, `v1-128k`, `v1-8k` — no-reasoning, rápidos, temperature flexible
- `kimi-k2-turbo-preview` — **NO existe** (intentamos antes)

---

## 🔄 Cómo reiniciar todo desde cero

```bash
# 1. Kill todo
pkill -f "bun.*apps/agent" 2>/dev/null
pkill -f "bun.*apps/whatsapp" 2>/dev/null
pkill -f cloudflared 2>/dev/null
sleep 2

# 2. Tunnel primero (necesitamos la URL antes de arrancar whatsapp)
cloudflared tunnel --url http://localhost:3002 --no-autoupdate &
sleep 8
# Copiar la URL de los logs de cloudflared

# 3. Update WA_URL en .env con la nueva URL del tunnel
# 4. Update webhook en Twilio Sandbox console

# 5. Arrancar agent (terminal separado)
cd apps/agent && bun --env-file=../../.env run --hot src/index.ts

# 6. Arrancar whatsapp (terminal separado)
cd apps/whatsapp && bun --env-file=../../.env run --hot src/index.ts

# 7. Smoke test
curl http://localhost:3002/health
curl http://localhost:3003/health
curl <CLOUDFLARED_URL>/health
```

---

## 📊 Para tus otros agentes — checklist al iniciar trabajo

- [ ] `git fetch origin && git pull origin main`
- [ ] Verificar que la branch que crean **no tope con archivos de PR #13**
- [ ] `bun install` si hay cambios en `package.json` o `bun.lock`
- [ ] Si modifican `packages/config/src/env.ts`, **avisar antes** (alta probabilidad de conflict con cualquier branch que toca env)
- [ ] Si modifican `apps/whatsapp` o `apps/agent`, esperar a que merge PR #13 primero
- [ ] No commitear `.env` (debería estar en `.gitignore`)
- [ ] No commitear `RUNNING.md` con valores reales de env (este archivo es público)

---

## 🎯 Próximos pasos (después de mergear PR #13)

1. ~~Hito 1: Echo bot~~ ✅ Implícito en el setup actual (signature OK + reply OK)
2. ~~Hito 2: Kimi text-only~~ ✅ Funcionando (Moonshot v1-32k)
3. **Hito 3: Tool use** — agregar 1 mock tool `consultar_perfil(wallet)` en `packages/agent-tools` y hacer que el agent service haga el loop
4. **Hito 4: Tools reales** — cuando `apps/api` esté deployado y `feat/anchor-tanda-flow` mergeado, conectar tools a endpoints reales
5. **Templates Twilio aprobados** para outbound fuera de 24h window:
   - `tanda_recordatorio`
   - `tanda_payout_listo`
   - `kyc_pendiente`
6. **Persistir conversación a Postgres** además de Redis (para analytics y para sobrevivir restart de Redis)
