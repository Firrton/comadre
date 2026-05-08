# Development

## Prerrequisitos

| Tool | Versión |
|---|---|
| Bun | ≥ 1.2.0 |
| Rust | stable + `rustup` |
| Solana CLI | ≥ 2.0 |
| Anchor | 0.31 (`avm install 0.31.0 && avm use 0.31.0`) |
| Node | 22 (para tooling — no para runtime) |
| Postgres | 15 (o usar Supabase remoto) |
| Docker | opcional, para Postgres local |

## Setup

```bash
git clone https://github.com/Firrton/comadre.git
cd comadre
bun install
cp .env.example .env.local
```

Llenar `.env.local`:
1. `HELIUS_API_KEY` — sign up en helius.dev
2. `PRIVY_APP_ID` / `PRIVY_APP_SECRET` — privy.io dashboard
3. `SUMSUB_*` — sumsub.com sandbox
4. `META_*` — developers.facebook.com → WhatsApp Business API
5. `ANTHROPIC_API_KEY` — console.anthropic.com
6. `DATABASE_URL` — Supabase free tier
7. `UPSTASH_REDIS_*` — Upstash free tier
8. `FEE_PAYER_SK` etc — generar con `solana-keygen new`

## Generar wallets locales

```bash
mkdir -p keypairs
solana-keygen new -o keypairs/fee_payer.json --no-bip39-passphrase
solana-keygen new -o keypairs/crank_authority.json --no-bip39-passphrase
solana-keygen new -o keypairs/kyc_oracle.json --no-bip39-passphrase
solana-keygen new -o keypairs/admin.json --no-bip39-passphrase

# Airdrop devnet SOL a cada uno
solana airdrop 2 $(solana-keygen pubkey keypairs/fee_payer.json) --url devnet
```

Convertir a base58 SK para `.env.local`:
```bash
bun run scripts/keypair-to-sk.ts keypairs/fee_payer.json
```

## Build smart contract

```bash
cd packages/anchor-program
anchor build
anchor test                          # local validator
anchor deploy --provider.cluster devnet
```

Después de deploy, copiar el `Program ID` a:
- `Anchor.toml`
- `programs/comadre/src/lib.rs` → `declare_id!`
- `.env.local` → `COMADRE_PROGRAM_ID`

Re-build una vez:
```bash
anchor build && anchor deploy --provider.cluster devnet
```

Y regenerar TS client:
```bash
bun run codegen:client
```

## DB migrations

```bash
bun run db:generate    # genera migration desde schema.ts
bun run db:migrate     # aplica
bun run db:studio      # UI en localhost:4983
```

## Levantar todo

```bash
bun run dev
```

Servicios corren en:
- API → http://localhost:3001
- WhatsApp → http://localhost:3002
- Agent → http://localhost:3003
- Indexer → http://localhost:3004
- Web → http://localhost:3000
- Mobile (Expo) → exp://localhost:19000

## WhatsApp local testing

Meta no llama a `localhost`. Opciones:
1. **ngrok**: `ngrok http 3002` → setear webhook URL en Meta dashboard
2. **Cloudflare Tunnel**: `cloudflared tunnel --url http://localhost:3002`

## Helius webhook local

Usar mismo ngrok/tunnel + setear via Helius dashboard o:
```bash
bun run scripts/setup-helius-webhook.ts
```

## Mobile (Expo) en Solana Seeker

```bash
cd apps/mobile
bun run android       # con Seeker conectado por USB
```
