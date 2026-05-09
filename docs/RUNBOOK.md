# Comadre — Operations runbook

> Procedimientos paso-a-paso para deploy, bootstrap on-chain, y troubleshooting común. Para setup del entorno de desarrollo local ver `DEVELOPMENT.md`. Para el estado del MVP ver `CHECKLIST.md`.

## TOC

1. [Setup local](#1-setup-local)
2. [Anchor program — build y deploy a devnet](#2-anchor-deploy)
3. [Bootstrap on-chain (`init_config`)](#3-bootstrap)
4. [IDL upload (`anchor idl init`)](#4-idl-upload)
5. [Codegen cliente TypeScript](#5-codegen)
6. [Mint USDC de prueba en devnet](#6-mint-test-usdc)
7. [Levantar servicios backend localmente](#7-run-services)
8. [Configurar Twilio webhook (ngrok)](#8-twilio-webhook)
9. [Migrar base de datos (Drizzle)](#9-db-migrate)
10. [Errores comunes](#10-errors)

---

## 1. Setup local

### Prerequisitos

| Tool | Versión mínima | Verificar |
|---|---|---|
| Bun | 1.2+ | `bun --version` |
| Rust | 1.79 (fork via platform-tools) | `rustc --version` |
| Solana CLI | 2.1.7 (Agave) | `solana --version` |
| Anchor | 0.31.0 via avm | `anchor --version` |
| Node.js | no requerido (Bun lo reemplaza) | — |

### Variables de entorno

```bash
cp .env.example .env.local
# Editar .env.local con los valores reales (ver CHECKLIST.md § Credenciales en .env)
```

Variables críticas para el MVP (sin estas nada funciona):

```
SOLANA_RPC_URL        # Helius devnet con API key
FEE_PAYER_SK          # base58 SK de la wallet sponsor
PRIVY_APP_ID
PRIVY_APP_SECRET
PRIVY_VERIFICATION_KEY
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN     # ROTAR si se filtró — solo para webhook verify
TWILIO_API_KEY_SID    # SK... (scoped, para outbound)
TWILIO_API_KEY_SECRET
TWILIO_WHATSAPP_FROM  # whatsapp:+14155238886 (sandbox)
LLM_PROVIDER          # moonshot o groq
MOONSHOT_API_KEY      # o GROQ_API_KEY según LLM_PROVIDER
KIMI_MODEL            # kimi-k2-0905-preview
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
DATABASE_URL          # postgresql://... con ?pgbouncer=true&connection_limit=1
INTERNAL_HMAC_SECRET  # openssl rand -hex 32
COMADRE_PROGRAM_ID    # después de deploy
```

### Instalar dependencias

```bash
bun install
```

---

## 2. Anchor program — build y deploy a devnet

### Paso a paso manual

```bash
cd packages/anchor-program

# 1. Generar keypair del programa (si no existe)
mkdir -p target/deploy
[ -f target/deploy/comadre-keypair.json ] || \
  solana-keygen new -o target/deploy/comadre-keypair.json \
    --no-bip39-passphrase --silent

# 2. Obtener el program ID
PROGRAM_ID=$(solana address -k target/deploy/comadre-keypair.json)
echo "Program ID: $PROGRAM_ID"

# 3. Actualizar declare_id! y Anchor.toml con el program ID real
#    En lib.rs: declare_id!("<PROGRAM_ID>");
#    En Anchor.toml: [programs.devnet] comadre = "<PROGRAM_ID>"
#    (el script deploy-program.sh hace esto automáticamente)

# 4. Build
anchor build

# 5. Deploy
anchor deploy --provider.cluster devnet
```

### Via script

```bash
# Desde la raíz del monorepo
bash scripts/deploy-program.sh devnet
# El script hace: build → deploy → idl init/upgrade automáticamente
```

### Actualizar COMADRE_PROGRAM_ID

Después del deploy, copiar el program ID en `.env.local`:

```
COMADRE_PROGRAM_ID=<program-id-obtenido-en-paso-2>
```

---

## 3. Bootstrap on-chain (`init_config`)

`init_config` es una instrucción singleton que configura el `ProgramConfig` PDA. Solo puede llamarse una vez (Anchor rechaza re-init) y solo el deployer autorizado puede llamarla en devnet/mainnet.

### Parámetros

| Param | Descripción | Ejemplo devnet |
|---|---|---|
| `kyc_oracle` | Pubkey de la wallet `kyc_oracle` | ver `KYC_ORACLE_SK` |
| `crank_authority` | Pubkey de la wallet `crank_authority` | ver `CRANK_AUTHORITY_SK` |
| `fee_bps` | Fee en basis points (1 bps = 0.01%) | `50` (0.5%) |
| `fee_destination` | Pubkey que recibe el fee | fee_payer o multisig |
| `kyc_limits[4]` | Límites USDC en micro-USDC por tier [T0,T1,T2,T3] | `[10_000_000, 50_000_000, 500_000_000, 5_000_000_000]` |

### Ejecutar

```bash
# Via script TS (recomendado)
bun run scripts/seed-db.ts
# O directamente con Anchor CLI (requiere configurar el provider correctamente)
```

Si `init_config` ya fue ejecutado y se quiere verificar el estado:

```bash
# Usando Anchor client o Solana Explorer
solana account <program-config-pda> --url devnet
```

---

## 4. IDL upload (`anchor idl init`)

El IDL on-chain permite a herramientas como Anchor TS client y exploradores parsear instrucciones y eventos del programa.

```bash
cd packages/anchor-program

PROGRAM_ID=$(solana address -k target/deploy/comadre-keypair.json)

# Primera vez
anchor idl init "$PROGRAM_ID" \
  --filepath target/idl/comadre.json \
  --provider.cluster devnet

# Si el programa ya tiene IDL y se actualiza
anchor idl upgrade "$PROGRAM_ID" \
  --filepath target/idl/comadre.json \
  --provider.cluster devnet
```

El script `scripts/deploy-program.sh` intenta `idl init` y hace fallback a `idl upgrade` automáticamente.

---

## 5. Codegen cliente TypeScript

Después de cualquier cambio al programa Anchor que modifique el IDL:

```bash
# Desde la raíz del monorepo
bun run codegen:client
```

Esto ejecuta `scripts/codegen-client.sh`, que:
1. Hace `anchor build` (regenera el IDL)
2. Copia `target/idl/comadre.json` → `packages/anchor-client/src/idl/`
3. Copia `target/types/comadre.ts` → `packages/anchor-client/src/idl/`

Los cambios en `packages/anchor-client` deben commitearse para que los demás servicios piquen el tipo actualizado.

---

## 6. Mint USDC de prueba en devnet

El USDC de devnet usado por Comadre tiene mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (USDC devnet canónico de Circle).

### Opción A — Circle faucet (recomendado)

1. Ir a [faucet.circle.com](https://faucet.circle.com/)
2. Seleccionar chain: **Solana**
3. Seleccionar red: **Devnet**
4. Ingresar la wallet address (fee_payer o la wallet del usuario de prueba)
5. Recibir USDC de prueba (límite: 10 USDC / día / wallet)

### Opción B — SPL Token Faucet via CLI

```bash
# Requiere: spl-token CLI instalado
# Usar un mint de prueba local (solo funciona en localnet)
spl-token create-token --decimals 6
spl-token create-account <mint>
spl-token mint <mint> 1000 <token-account>
```

### Verificar balance

```bash
spl-token accounts --owner <wallet-address> --url devnet
```

---

## 7. Levantar servicios backend localmente

Cada servicio es independiente. Levantar en terminales separadas o con un process manager.

```bash
# Terminal 1 — API service
bun run --filter apps/api dev
# escucha en :3001

# Terminal 2 — WhatsApp service
bun run --filter apps/whatsapp dev
# escucha en :3002

# Terminal 3 — Agent service
bun run --filter apps/agent dev
# escucha en :3003
```

Verificar que los servicios estén vivos:

```bash
curl http://localhost:3001/health
curl http://localhost:3002/health
curl http://localhost:3003/health
# Todos deben retornar { "ok": true, "service": "<nombre>" }
```

---

## 8. Configurar Twilio webhook (ngrok)

Para que Twilio pueda enviar mensajes entrantes al servicio local:

```bash
# 1. Iniciar ngrok apuntando al WhatsApp service
ngrok http 3002
# Ngrok muestra una URL pública tipo: https://abc123.ngrok-free.app

# 2. Configurar en Twilio Console:
#    Sandbox Settings → "WHEN A MESSAGE COMES IN"
#    → https://abc123.ngrok-free.app/webhook
#    → HTTP POST

# 3. Actualizar WA_URL en .env.local
WA_URL=https://abc123.ngrok-free.app
```

**Importante**: la URL del webhook debe incluir `https://` (Twilio rechaza HTTP). El `WA_URL` en `.env.local` debe coincidir exactamente con la URL que Twilio usa para calcular la firma.

### Unirse al sandbox

```bash
# Desde el WhatsApp personal del desarrollador:
# Enviar "join <código-del-sandbox>" al número +14155238886
# El código está en Twilio Console → Messaging → Try it Out → WhatsApp
```

---

## 9. Migrar base de datos (Drizzle)

```bash
# Generar SQL de migración (requiere DIRECT_URL configurada)
bun run --filter packages/db migrate:generate

# Aplicar migraciones
bun run --filter packages/db migrate:push
```

`DATABASE_URL` usa pgbouncer (para el pool en producción). `DIRECT_URL` bypassa pgbouncer y es necesaria para que Drizzle Kit aplique migraciones DDL.

---

## 10. Errores comunes

### Anchor / Solana

| Error | Causa | Fix |
|---|---|---|
| `Error: failed to send transaction: Transaction simulation failed` | fee_payer sin SOL | `solana airdrop 2 <fee-payer-addr> --url devnet` o usar [faucet.solana.com](https://faucet.solana.com) |
| `AnchorError: AccountDiscriminatorMismatch` | IDL desactualizado en el cliente | `bun run codegen:client` y restart servicios |
| `edition2024` compile error | Transitive dep con edition incompatible | Verificar `Cargo.lock` pinneado; ver `.cargo/config.toml` con `procmacro2_semver_exempt` |
| `Error: Account does not exist` en init_config | ProgramConfig PDA no inicializado | Ejecutar `init_config` (ver §3) |
| `ComadreError::Unauthorized` en init_config | Llamador no es `INITIAL_DEPLOYER` | Usar el keypair correcto del deployer; o en localnet usar feature flag |
| `ComadreError::ProgramPaused` | Admin llamó `pause(true)` | `pause(false)` desde keypair admin |

### Twilio

| Error | Causa | Fix |
|---|---|---|
| `403 invalid signature` en `/webhook` | `WA_URL` no coincide con la URL que Twilio usa | Asegurar que `WA_URL` en `.env.local` sea la URL exacta de ngrok (con https) |
| Mensajes no llegan | Sandbox no joined | Enviar `join <código>` desde el WhatsApp del dev |
| `Error 63038: Channel does not exist` | Twilio sandbox expirado | Re-join al sandbox |
| Outbound falla con 401 | `TWILIO_API_KEY_SID`/`SECRET` incorrectos | Verificar scope Main en Twilio Console |

### Privy

| Error | Causa | Fix |
|---|---|---|
| `Invalid Privy token` (401) | Token expirado o `PRIVY_VERIFICATION_KEY` desactualizada | Descargar nueva verification key de Privy Dashboard |
| `walletApi.solana.signTransaction` falla | `walletId` incorrecto o wallet no creada | Verificar `linkedAccounts` del JWT; wallet debe existir en Privy |
| `importUser` duplicado | Phone ya registrado en Privy | Usar `getUser` por phone para recuperar el userId existente |

### Redis / Upstash

| Error | Causa | Fix |
|---|---|---|
| `EXPIRED` en `/transfers/:id/confirm` | TTL de 5 min expiró antes de confirmar | Usuario debe reiniciar la transferencia |
| `Error: Redis connection failed` | `UPSTASH_REDIS_REST_URL`/`TOKEN` incorrectos | Verificar en Upstash Console; los tests continúan sin Redis |

### Base de datos

| Error | Causa | Fix |
|---|---|---|
| `prepared statement already exists` | pgbouncer en transaction mode con Drizzle | Asegurar `?pgbouncer=true&connection_limit=1` en `DATABASE_URL` |
| `relation "users" does not exist` | Migraciones no aplicadas | `bun run --filter packages/db migrate:push` |
| `unique constraint violation` en `phone_hash` | Race condition de onboarding doble | El handler debe usar `ON CONFLICT DO NOTHING` o `DO UPDATE` |
