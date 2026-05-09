# Development

> Setup local del backend. Para deploy y operations ver `docs/RUNBOOK.md`.

## Prerrequisitos

| Tool | Versión |
|---|---|
| Bun | ≥ 1.2.0 |
| Rust | stable + `rustup` |
| Solana CLI | ≥ 2.0 (Agave) |
| Anchor | 0.31 (`avm install 0.31.0 && avm use 0.31.0`) |
| Postgres | 15 (Supabase remoto recomendado) |
| Docker | opcional |

## Setup

```bash
git clone https://github.com/Firrton/comadre.git
cd comadre
bun install
cp .env.example .env.local
```

## Cuentas externas requeridas (`.env.local`)

| Var | Servicio | Notas |
|---|---|---|
| `HELIUS_API_KEY` | helius.dev | RPC + webhooks Solana (devnet + mainnet) |
| `PRIVY_APP_ID` / `PRIVY_APP_SECRET` | privy.io | Auth + embedded Solana wallets habilitados |
| `TWILIO_ACCOUNT_SID` | twilio.com | account principal (`AC...`) |
| `TWILIO_AUTH_TOKEN` | twilio.com | **rotado, solo para webhook signature verify** |
| `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET` | twilio.com | API Key scoped para outbound (`SK...`) |
| `TWILIO_WHATSAPP_FROM` | twilio.com | sandbox: `whatsapp:+14155238886` |
| `LLM_PROVIDER` | env | `moonshot` o `groq` |
| `MOONSHOT_API_KEY` | moonshot.ai | requerido si `LLM_PROVIDER=moonshot` |
| `GROQ_API_KEY` | groq.com | requerido si `LLM_PROVIDER=groq` |
| `KIMI_MODEL` | env | ej `kimi-k2-0905-preview` (Moonshot) o `moonshotai/kimi-k2-instruct` (Groq) |
| `DATABASE_URL` | Supabase | con `?pgbouncer=true&connection_limit=1` |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | upstash.com | Redis HTTP REST |
| `INTERNAL_HMAC_SECRET` | local | `openssl rand -hex 32` (≥32 chars) |
| `FEE_PAYER_SK`, `CRANK_AUTHORITY_SK`, `KYC_ORACLE_SK`, `ADMIN_SK` | local | base58 secret keys generados con `solana-keygen` (ver abajo) |
| `COMADRE_PROGRAM_ID` | post-deploy | el program ID real después de `anchor deploy` |
| `SUMSUB_*` | (opcional Phase 2) | sandbox para KYC |
| `SENTRY_DSN`, `BETTER_STACK_TOKEN` | opcional | observability |

> Nota post-pivot: el stack ya NO usa Meta Cloud API (es Twilio) ni Anthropic Claude (es Kimi K2 vía Moonshot/Groq). Si tu `.env.local` viejo tiene `META_*` o `ANTHROPIC_API_KEY`, podés quitarlos.

## Generar wallets locales

```bash
mkdir -p keypairs
solana-keygen new -o keypairs/fee_payer.json --no-bip39-passphrase
solana-keygen new -o keypairs/crank_authority.json --no-bip39-passphrase
solana-keygen new -o keypairs/kyc_oracle.json --no-bip39-passphrase
solana-keygen new -o keypairs/admin.json --no-bip39-passphrase

# Airdrop devnet SOL a cada uno (rate-limited; usar https://faucet.solana.com si falla)
solana airdrop 2 $(solana-keygen pubkey keypairs/fee_payer.json) --url devnet
solana airdrop 1 $(solana-keygen pubkey keypairs/crank_authority.json) --url devnet
solana airdrop 0.5 $(solana-keygen pubkey keypairs/kyc_oracle.json) --url devnet
solana airdrop 0.5 $(solana-keygen pubkey keypairs/admin.json) --url devnet
```

Convertir a base58 para `.env.local`:

```bash
bun run scripts/keypair-to-sk.ts keypairs/fee_payer.json
# output: 4PQwC4YcvGc5...   ← pega ese string en FEE_PAYER_SK=
```

> Las keypairs `keypairs/*.json` están en `.gitignore`. **NUNCA commitearlas.**

## Build smart contract + deploy a devnet

Para el procedimiento completo (con program keypair generation, IDL upload, codegen, init_config), ver **`docs/RUNBOOK.md`**. Quick form:

```bash
cd packages/anchor-program
anchor build
anchor deploy --provider.cluster devnet
anchor idl init <PROGRAM_ID> --filepath target/idl/comadre.json --provider.cluster devnet
cd ../..
bun run codegen:client
```

## DB migrations

```bash
bun run db:generate    # genera migration desde packages/db/src/schema.ts
bun run db:migrate     # aplica a DATABASE_URL
bun run db:studio      # UI en localhost:4983
```

## Levantar todo (Turbo)

```bash
bun run dev
```

Servicios backend que arrancan (5):

| Servicio | URL local | Logs |
|---|---|---|
| `apps/api` | http://localhost:3001 | pino → stdout |
| `apps/whatsapp` | http://localhost:3002 | pino → stdout |
| `apps/agent` | http://localhost:3003 | pino → stdout |
| `apps/indexer` | http://localhost:3004 | (esqueleto, no arranca todavía) |
| `apps/cron` | http://localhost:3005 | pino + node-cron |

Frontend (`apps/web`, `apps/mobile`) **excluidos del workspace** (PR #4 backend-only sprint). Para retomarlos hay que reincorporarlos a `package.json` workspaces.

## Tunneling para Twilio webhooks

Twilio sandbox no llama a `localhost`. Opciones:

1. **Cloudflare Tunnel** (recomendado, gratis, persistente con cuenta):
   ```bash
   cloudflared tunnel --url http://localhost:3002
   ```
2. **ngrok**: `ngrok http 3002`

Después:
- Update `WA_URL=https://<random>.trycloudflare.com` en `.env.local`
- Restart `apps/whatsapp` (Bun lee env al boot, no en hot reload)
- Update webhook URL en Twilio Sandbox settings → "When a message comes in" → `<tunnel-url>/webhook`

## Helius webhook local (post-deploy del Anchor program)

Mismo tunnel + script de setup:

```bash
bun run scripts/setup-helius-webhook.ts  # TODO — crear
```

## Tests

```bash
bun run test           # turbo: typecheck + test en cada package/app
```

Anchor tests (LiteSVM/local validator):
```bash
cd packages/anchor-program
anchor test
```

## Troubleshooting frecuente

| Error | Causa probable | Fix |
|---|---|---|
| `cargo: command not found '+solana'` | rustup toolchain `solana` desinstalado tras primer build | `export PATH="$HOME/.cache/solana/v1.48/platform-tools/rust/bin:$PATH"` antes de `anchor build` |
| `ECONNREFUSED 127.0.0.1:5432` en tests | Postgres local no corre (esperado en unit tests) | OK si los tests son tolerantes; para integration test arrancar DB local o usar Supabase |
| `Environment validation FAILED` en boot | falta una env var requerida | revisar `.env.local` vs `packages/config/src/env.ts` (Zod schema) |
| Twilio "Out of date" / 401 | `WA_URL` distinto del configurado en Twilio dashboard | actualizar webhook URL + restart `apps/whatsapp` |
| Privy `signTransaction` 4xx | embedded wallets Solana no habilitados | dashboard Privy → Settings → Wallets → Embedded → Enable Solana |

Para más procedimientos (deploy, init_config, mint USDC test) ver `docs/RUNBOOK.md`.
