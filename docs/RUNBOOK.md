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
8. [Configurar Twilio webhook (Cloudflared / ngrok)](#8-twilio-webhook)
9. [Migrar base de datos (Drizzle)](#9-db-migrate)
10. [Postgres local con Docker](#10-postgres-docker)
11. [Modelo de signing (custodial via Privy)](#11-signing-model)
12. [Flujo end-to-end: onboarding implícito por WhatsApp](#12-onboarding-flow)
13. [Flujo end-to-end: P2P USDC transfer](#13-p2p-flow)
14. [Flujo end-to-end: crear/unirse/aportar a una tanda](#14-tanda-flow)
15. [Limpieza de estado para re-tests](#15-state-cleanup)
16. [Estado actual del MVP — qué funciona, qué no](#16-mvp-state)
17. [Errores comunes](#17-errors)

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

## 8. Configurar Twilio webhook (Cloudflared / ngrok)

Para que Twilio pueda enviar mensajes entrantes al servicio local. **Recomendamos Cloudflared** (gratis, sin signup, más estable que ngrok free).

### Opción A — Cloudflare Tunnel (recomendado)

```bash
# 1. Instalar (una sola vez)
brew install cloudflared

# 2. Levantar tunnel apuntando al WhatsApp service
cloudflared tunnel --url http://localhost:3002 --no-autoupdate
# Output: "Your quick Tunnel has been created! Visit it at:
#          https://<random-words>.trycloudflare.com"
```

### Opción B — ngrok (alternativa)

```bash
ngrok http 3002
# URL: https://abc123.ngrok-free.app
```

### Configurar Twilio + actualizar `.env`

```bash
# 1. Capturar la URL del tunnel (cambia cada vez que arranca cloudflared)
TUNNEL_URL=https://<random>.trycloudflare.com   # o ngrok-free.app

# 2. Update WA_URL en .env.local (DEBE coincidir exacto con lo que Twilio usa)
sed -i '' "s|^WA_URL=.*|WA_URL=$TUNNEL_URL|" .env.local

# 3. Restart whatsapp service (Bun lee env al boot, no en hot reload)
lsof -ti:3002 | xargs kill -9
bun run --filter apps/whatsapp dev

# 4. Configurar webhook en Twilio Console:
#    Console → Messaging → Try it out → Send a WhatsApp message → Sandbox settings
#    → "WHEN A MESSAGE COMES IN" = $TUNNEL_URL/webhook
#    → HTTP POST
#    → Save
```

**Pitfall #1**: Twilio firma con la URL EXACTA que envió. Si `WA_URL` no coincide, el webhook handler responde 403 "invalid signature". El path `/webhook` es parte de la firma.

**Pitfall #2**: Cloudflared quick tunnels (sin cuenta) no tienen uptime SLA y la URL cambia cada vez. Para producción usar tunnel nombrado: `cloudflared tunnel create comadre` + `cloudflared tunnel route dns`.

### Unirse al sandbox

```
Desde el WhatsApp personal:
  Mensaje a +14155238886 → "join <código-del-sandbox>"

El código está en Twilio Console → Messaging → Try it Out → WhatsApp.
Vencé después de 72h de inactividad → re-join si caduca.
```

---

## 9. Migrar base de datos (Drizzle)

```bash
# Generar SQL de migración (requiere DIRECT_URL configurada)
bun run --filter packages/db migrate:generate

# Aplicar migraciones
bun run --filter packages/db migrate:push
# O directamente con el script:
cd packages/db && bun --env-file=../../.env run scripts/migrate.ts
```

`DATABASE_URL` usa pgbouncer (para el pool en producción). `DIRECT_URL` bypassa pgbouncer y es necesaria para que Drizzle Kit aplique migraciones DDL.

---

## 10. Postgres local con Docker

Si no tenés Supabase remoto, usá Postgres en Docker para dev:

```bash
# 1. Asegurarse que Docker daemon está corriendo
open -a Docker  # macOS
# Esperar ~30s hasta que docker ps responda

# 2. Levantar container Postgres
docker run -d --name comadre-pg \
  -e POSTGRES_USER=comadre \
  -e POSTGRES_PASSWORD=comadre \
  -e POSTGRES_DB=comadre \
  -p 5432:5432 \
  postgres:15

# 3. Verificar
docker exec comadre-pg pg_isready -U comadre

# 4. Update .env.local
DATABASE_URL=postgresql://comadre:comadre@localhost:5432/comadre
DIRECT_URL=postgresql://comadre:comadre@localhost:5432/comadre

# 5. Aplicar schema
cd packages/db && bun --env-file=../../.env run scripts/migrate.ts
```

### Inspeccionar datos

```bash
# Listar usuarios onboarded
docker exec comadre-pg psql -U comadre -d comadre \
  -c "SELECT wallet, kyc_tier, country_code, created_at FROM users;"

# Ver transferencias
docker exec comadre-pg psql -U comadre -d comadre \
  -c "SELECT id, sender_wallet, recipient_wallet, status, created_at FROM transfers ORDER BY created_at DESC LIMIT 10;"

# Conversaciones del agente (off-chain ledger)
docker exec comadre-pg psql -U comadre -d comadre \
  -c "SELECT user_wallet, channel, updated_at FROM conversations ORDER BY updated_at DESC LIMIT 5;"
```

### Detener / re-iniciar

```bash
docker stop comadre-pg
docker start comadre-pg
docker rm -f comadre-pg   # destruir y empezar de cero
```

---

## 11. Modelo de signing (custodial backend)

> **Reemplazo:** el documento previo describía Privy server-auth para signing. Privy fue removido. Esta sección refleja el modelo actual.

### Resumen

El backend guarda **un `Keypair` por usuario** en la DB. **No hay servicio externo de signing.** Todas las operaciones con keys ocurren in-process dentro de `comadre-api`.

### Generación de keys

En el primer consentimiento del onboarding (`apps/api/src/lib/onboarding.ts`):

```typescript
const keypair = Keypair.generate();
const secretKeyB58 = bs58.encode(keypair.secretKey); // 64 bytes
await db.insert(userKeypairs).values({
  wallet: keypair.publicKey.toBase58(),
  secretKeyB58,
});
```

### Firma de transacciones

`signWithUserKeypair(walletAddress)` carga la fila, reconstruye el `Keypair` y firma:

```typescript
const row = await db.query.userKeypairs.findFirst({
  where: eq(userKeypairs.wallet, walletAddress)
});
const keypair = Keypair.fromSecretKey(bs58.decode(row.secretKeyB58));
transaction.sign([keypair]);
```

### Airdrop al onboarding

Después de generar las keys, el flujo de onboarding airdropea **0.05 SOL** del `fee_payer` al wallet nuevo. Esto cubre rent para creación de cuentas de tanda. Es un paso devnet-only; en mainnet la plataforma fundearía la primera interacción del user de otra forma.

### Recuperar la public key de un user

```sql
SELECT wallet FROM users WHERE phone_hash = '<sha256>';
```

(El número WhatsApp se hashea con SHA-256 antes de buscarlo.)

### Rotación manual de keypair

No hay flujo automatizado de rotación. Para una rotación manual:

1. Generar nuevo `Keypair` off-chain.
2. Transferir cualquier balance SOL/token de la wallet vieja a la nueva con tx firmada por la key vieja.
3. Update `user_keypairs` y `users.wallet`.
4. Update referencias en `tandas.creator_wallet`.

Operación manual de alto riesgo. La ausencia de tooling de rotación es una limitación conocida del hackathon.

### Disaster recovery

- La única source-of-truth para secret keys es la tabla `user_keypairs` en Postgres.
- Backup diario mínimo de Postgres (`pg_dump`). El VPS no tiene snapshots automáticos configurados al cierre del hackathon.
- Pérdida de `user_keypairs` = pérdida permanente de acceso a todas las wallets de users y fondos on-chain.

## 12. Flujo end-to-end: onboarding implícito por WhatsApp

### Diagrama

```
📱 User: "hola comadre"  (phone: +5218116346072)
   ↓
🌐 Twilio webhook → cloudflared tunnel → apps/whatsapp:3002
   ↓ verifica X-Twilio-Signature
   ↓ POST agent_url/process { from, body, conversationKey }
🟪 apps/agent:3003
   ├─ resolveUserFromTwilio(from) → null (no registrado)
   ├─ Carga history vacía de Redis
   └─ runAgent({ history, userMessage, userWallet=null, senderPhone="+528116346072" })
       ├─ Kimi K2 con ALL_TOOLS y system prompt
       ├─ Detecta saludo + sin wallet → NO llama tool, responde texto:
       │   "¡Hola mija! Soy Comadre... ¿le damos? (sí o registrame)"
       └─ Persiste history en Redis (TTL 24h)
   ↓ { reply }
🟦 apps/whatsapp → Twilio Messages API → 📱 user

📱 User: "sí"
   ↓
🟪 apps/agent
   ├─ resolveUser → null todavía
   └─ runAgent → Kimi detecta consent → tool_call iniciar_onboarding({})
       ├─ executeTool (toolContext.senderPhone="+528116346072")
       └─ apiCall POST /api/v1/onboarding/init { phone }
🌐 apps/api:3001
   ├─ Skip authMiddleware (path /api/v1/onboarding está en bypass)
   ├─ onboardPhone()
   │   ├─ normalizePhoneE164("+5218116346072") → "+528116346072"
   │   ├─ privy.getUserByPhoneNumber("+528...072") → null
   │   ├─ privy.importUser({ linkedAccounts: [{type:"phone", number:"+528..."}], createSolanaWallet: true })
   │   ├─ findSolanaEmbeddedWallet(linkedAccounts) → { address, id }
   │   └─ INSERT INTO users (wallet, phone_hash, kyc_tier="t0_demo", ...)
   └─ Returns { walletAddress, walletId, privyUserId, alreadyExisted: false }
   ↓
🟪 apps/agent → Kimi formatea respuesta:
   "¡Listo mija! Te creé tu billetera, termina en ...XXXX. KYC T0 demo (hasta $20 USDC/tx)..."
   ↓
🟦 apps/whatsapp → Twilio → 📱 user
```

### Validación end-to-end

```bash
# 1. Phone está en Privy
curl -s -u $PRIVY_APP_ID:$PRIVY_APP_SECRET \
  -H "privy-app-id: $PRIVY_APP_ID" \
  https://auth.privy.io/api/v1/users \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['data'][0]['linked_accounts'])"

# 2. Wallet existe en DB
docker exec comadre-pg psql -U comadre -d comadre \
  -c "SELECT wallet, kyc_tier FROM users WHERE phone_hash = '$(echo -n '+528116346072' | shasum -a 256 | awk '{print $1}')';"

# 3. Wallet existe en Solana (sin balance todavía)
curl -s -X POST $SOLANA_RPC_URL -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getBalance","params":["<wallet>"]}'
```

---

## 13. Flujo end-to-end: P2P USDC transfer

> **Pre-requisito**: ambos usuarios (sender + recipient) onboardados. Sender con USDC devnet en su ATA.

### Diagrama

```
📱 Sender: "manda 5 USDC al +52 8116346072"
   ↓
🟪 apps/agent
   ├─ resolveUser → wallet del sender (ya onboarded)
   └─ Kimi → tool_call iniciar_transfer({ to_phone: "+5218116346072", amount_usdc: 5 })
       ↓
🌐 apps/api POST /api/v1/transfers
   ├─ authMiddleware (Privy JWT o X-Dev-Wallet bypass)
   ├─ phoneLookup(to_phone) → recipient wallet (o null si no registrado)
   ├─ kycLimits check: 5 USDC <= 20 (T0Demo) ✓
   ├─ if recipient null:
   │   - Insert transfer status="awaiting_recipient"
   │   - Mandar WA al recipient: "te quieren mandar X USDC, escribime 'aceptar'"
   │   - Return { mode: "deferred" }
   ├─ if self-transfer: 400 SELF_TRANSFER
   ├─ Build SPL Token Transfer instruction:
   │   - createATAIfNeeded(recipient_ata, mint=USDC, payer=fee_payer)
   │   - createTransferInstruction(source=sender_ata, dest=recipient_ata, owner=sender_wallet, amount)
   ├─ buildUnsignedTx(ixs, fee_payer firma rent + priority)
   ├─ Stash unsignedTxBase64 en Redis (TTL 5 min, key: tx:<transferId>)
   └─ Return { transferId, recipient: { phone, walletPreview }, amount, expiresAt }
   ↓
🟪 agent: "¿Confirmás 5 USDC a +52... (wallet ...J4yX)?"
   ↓
📱 Sender: "sí"
   ↓
🟪 agent → tool_call confirmar_transfer({ transfer_id })
🌐 apps/api POST /api/v1/transfers/:id/confirm
   ├─ Verifica que el JWT del confirmador == sender_wallet del transfer
   ├─ Fetch unsignedTxBase64 de Redis (sino → 409 EXPIRED)
   ├─ Privy: walletApi.solana.signTransaction({ walletId: senderPrivyWalletId, transaction })
   │   → ahora la tx tiene fee_payer signature + sender signature (full sign)
   ├─ submitWithRetry(tx) con Helius (priority fees + retries 3x)
   ├─ Wait 1 confirmation
   ├─ UPDATE transfers SET status="confirmed", tx_signature=<sig>
   └─ Return { signature, status: "confirmed", explorerUrl: "solscan.io/tx/..." }
   ↓
🟪 agent: "✅ Listo, 5 USDC enviados. Tx: https://solscan.io/tx/..."
```

### Casos manejados

| Caso | Resultado |
|---|---|
| Self-transfer (sender_phone == recipient_phone) | 400 `SELF_TRANSFER` — agent responde con humor |
| Recipient no registrado, amount < $50 | 200 `mode=deferred` + claim link via WA al recipient |
| Recipient no registrado, amount >= $50 | 400 `RECIPIENT_NOT_REGISTERED` |
| Amount > KYC tier limit | 400 `KYC_LIMIT_EXCEEDED` con info de tier + límite |
| Sender sin balance USDC | 400 `INSUFFICIENT_BALANCE` con balance actual |
| Confirm después de 5 min | 409 `EXPIRED` — sender debe re-iniciar |
| Privy sign fail | 502 `PRIVY_SIGN_FAILED` |
| Broadcast fail 3x | 502 `BROADCAST_FAILED` con `failure_reason` persisted |

### Validar el resultado

```bash
# 1. Tx en Solana
solana confirm <signature> --url devnet

# 2. Recipient ATA balance
spl-token accounts --owner <recipient> --url devnet

# 3. Transfer row en DB
docker exec comadre-pg psql -U comadre -d comadre \
  -c "SELECT id, status, tx_signature, amount_micro_usdc FROM transfers ORDER BY created_at DESC LIMIT 1;"
```

---

## 14. Flujo end-to-end: crear/unirse/aportar a una tanda

> **Pre-requisitos**: Anchor program desplegado a devnet (§2), `init_config` ejecutado (§3), IDL on-chain (§4), TS client codegen (§5).

### Crear una tanda

```
📱 Creator: "quiero crear una tanda de $50 USDC con 5 personas, semanal"
   ↓
🟪 agent → tool_call crear_tanda({
    name: "Ahorro de Maria",
    member_target: 5,
    contribution_amount_cents: 5000,    // $50 USD
    frequency_days: 7,
    payout_order_mode: "creator_set"
})
   ↓
🌐 apps/api POST /api/v1/tandas
   ├─ Validate KYC tier (creator debe tener T1+)
   ├─ Anchor instruction create_tanda:
   │   - Tanda PDA: ["tanda", creator_wallet, tanda_id_le_bytes]
   │   - Vault PDA: ["vault", tanda_pda]
   │   - Init Tanda + Vault token account (USDC mint)
   ├─ buildUnsignedTx → Privy sign → submit
   ├─ INSERT INTO tandas (state="forming", member_target=5, ...)
   └─ Return { tanda_id (pda), unsigned_tx, signature }
   ↓
🟪 agent: "Tanda 'Ahorro de Maria' creada. ID: <pda>. Comparte este link
            para invitar miembros: comadre.app/join/<pda>"
```

### Unirse a una tanda

```
📱 Member: "unirme a tanda <pda-corto>"
   ↓
🟪 agent → tool_call unirse_tanda({ tanda_id })
   ↓
🌐 apps/api POST /api/v1/tandas/:id/join
   ├─ Validate state=="forming" + slots disponibles + KYC
   ├─ Anchor join_tanda:
   │   - Member PDA: ["member", tanda_pda, user_wallet]
   │   - Transfer stake (1× contribution_amount) de user_ata → vault
   ├─ Privy sign → submit
   ├─ INSERT INTO members (turn_number, stake_locked, ...)
   ├─ UPDATE tandas SET member_current = member_current + 1
   └─ Si member_current == member_target → state="active", próximo aporte programado
```

### Aportar al turno actual

```
📱 Cron / Member: contribute al turno N
   ↓
🟪 agent (o cron) → tool_call aportar_turno({ tanda_id })
   ↓
🌐 apps/api POST /api/v1/tandas/:id/contribute
   ├─ Anchor contribute:
   │   - Transfer contribution_amount de user_ata → vault
   │   - Increment member.contributions_made
   ├─ Privy sign → submit
   └─ Si todos aportaron este turno → cron payoutCrank ejecuta payout()
```

### Payout (auto via cron)

```
🤖 apps/cron payoutCrank (cada 5 min)
   ├─ SELECT tandas WHERE state='active' AND next_payout_ts <= now()
   ├─ Para cada una:
   │   - Calcula beneficiary del turno actual (según payout_order_mode)
   │   - Anchor payout instruction:
   │     - Transfer (member_target × contribution) de vault → beneficiary_ata
   │     - Advance current_turn
   │   - Sign con crank_authority + fee_payer (NO requiere sign del user)
   │   - submitWithRetry
   └─ UPDATE tandas SET current_turn += 1, next_payout_ts += frequency_seconds
```

### Estado actual (qué funciona y qué no)

| Pieza | Estado |
|---|---|
| Anchor program desplegado | ✅ devnet, program ID `BfVXncFhJdSsDciLx7UzVjFbEBw1EtcnJCsYSRis54Sh` |
| `init_config` ejecutado | ❌ **NO** — bloqueante para todas las tandas |
| IDL on-chain | ❌ **NO** — `anchor idl init` no ejecutado |
| Codegen TS client | ❌ **NO** — `bun run codegen:client` no ejecutado |
| Tools `crear_tanda`, etc. | ✅ definidas y typecheck pass |
| Cron `payoutCrank` | 🟡 stub (no llama Anchor real) |

**Para destrabar tandas**: ejecutar §3 (init_config) → §4 (idl init) → §5 (codegen) → testear.

---

## 15. Limpieza de estado para re-tests

Cuando querés probar el flow de onboarding desde cero (con un user que parezca nuevo):

```bash
# 1. Borrar la fila de la DB (deja la wallet en Privy intacta)
docker exec comadre-pg psql -U comadre -d comadre \
  -c "DELETE FROM users WHERE wallet = '<wallet-pubkey>';"

# 2. Limpiar la conversación en Redis (sino el agent recuerda contexto previo)
PHONE_FROM=whatsapp:+5218116346072
curl -s "$UPSTASH_REDIS_REST_URL/del/agent:conv:$PHONE_FROM" \
  -H "Authorization: Bearer $UPSTASH_REDIS_REST_TOKEN"
```

Privy NO se resetea (es API externa). El siguiente onboarding va a devolver `alreadyExisted: true` con el mismo `walletAddress` — eso es correcto idempotencia, no un bug.

Para empezar 100% desde cero (incluyendo Privy):
1. console.privy.io → Users → buscar por phone → Delete user
2. Repetir cleanup local

---

## 16. Estado actual del MVP — qué funciona, qué no

### ✅ FUNCIONANDO (verificado E2E)

- **Onboarding por WhatsApp**: phone → consent → Privy wallet + DB row
- **Tool-use loop del agent**: max 5 iteraciones, dispatcha a tools
- **Twilio webhook signature verify**: rechaza forge/replay
- **Cloudflared tunnel para dev**: webhook llega a localhost
- **Postgres local Docker + migrations Drizzle**
- **Conversation state en Redis** (Upstash REST API), TTL 24h
- **API services healthchecks**: api/agent/whatsapp todos `/health 200`

### 🟡 PARCIAL (código existe, falta deploy/wiring on-chain)

- **P2P USDC transfer**: endpoints + tools + Privy signing implementados, pero todavía sin probar E2E (faltan USDC devnet en el sender + un recipient registered)
- **Tandas (create/join/contribute/payout)**: tools + endpoints listos, pero el program necesita `init_config` ejecutado y IDL upload
- **KYC**: `solicitar_kyc` tool retorna stub; integración Sumsub real es Fase 2
- **Cron jobs**: scaffold OK, lógica real depende de codegen del Anchor client

### ❌ NO IMPLEMENTADO

- Disputas (open / vote / resolve) — programa Anchor compila pero NO probado
- Loans (request/cosign/disburse) — instrucciones existen pero scope post-hackathon
- Voice (ElevenLabs) — Fase 2
- Mobile (Solana Mobile Stack) — Fase 2
- Web (Next.js admin) — Fase 2

### 🚧 LIMITACIONES CONOCIDAS DEL MVP

- **Custodial signing**: ver §11. Privy controla las keys.
- **Auth-by-channel**: el "sí" en WhatsApp = autorización implícita. Sin OTP/PIN/biometric en MVP.
- **No hay onboarding del recipient deferred**: si un sender intenta mandar a phone no registrado, hay claim_link pero el flujo de "aceptar" requiere agent prompt updates aún no probados.
- **Cloudflared quick tunnel**: URL cambia en cada reinicio → hay que actualizar `WA_URL` + Twilio webhook manualmente.
- **`init_config` y IDL pending**: bloquea todas las features de tandas/loans/disputes en devnet.

---

## 17. Errores comunes

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
