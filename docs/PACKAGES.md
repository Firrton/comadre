# Comadre — Packages reference

> Referencia técnica de los 8 packages del monorepo. Cada sección sigue el mismo formato: propósito, exports principales, ejemplos de uso, dependencias, gotchas.
>
> **Convenciones de monto**: todos los montos monetarios se expresan en unidades atómicas (micro-USDC, 6 decimales). 1 USDC = 1 000 000 atomic units. En JSON se transmiten como string o bigint para evitar pérdida de precisión IEEE 754.

## TOC

- [@comadre/config](#comadreconfig)
- [@comadre/types](#comadretypes)
- [@comadre/db](#comadredb)
- [@comadre/cache](#comadrecache)
- [@comadre/anchor-client](#comadreanchor-client)
- [@comadre/solana](#comadresolana)
- [@comadre/agent-tools](#comadreagent-tools)
- [@comadre/anchor-program](#comadreanchor-program)

---

## @comadre/config

**Propósito**: validación única y eager de todas las variables de entorno del monorepo. Provee un singleton `env` totalmente tipado. Es el package base — no depende de ningún otro package interno.

**Source**: `packages/config/src/`

### Exports

| Symbol | Tipo | Qué hace |
|---|---|---|
| `env` | `Env` (singleton) | Objeto ya validado, disponible al importar el módulo. Dispara `process.exit(1)` si falla la validación. |
| `envSchema` | `z.ZodIntersection<...>` | Schema Zod completo. Útil para tests que necesiten parsear un subset. |
| `loadEnv()` | `() => Env` | Versión lazy e idempotente. Llama `process.exit(1)` en la primera invocación si hay errores; en las siguientes devuelve el resultado cacheado. |

### Grupos de variables validadas

| Grupo | Variables clave | Notas |
|---|---|---|
| Solana | `SOLANA_CLUSTER`, `SOLANA_RPC_URL`, `SOLANA_WS_URL`, `COMADRE_PROGRAM_ID`, `USDC_MINT` | Cluster acepta `devnet \| mainnet-beta \| testnet \| localnet` |
| Wallets | `FEE_PAYER_SK`, `CRANK_AUTHORITY_SK`, `KYC_ORACLE_SK`, `ADMIN_SK` | Base58 secret keys de 64 bytes |
| Privy | `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_VERIFICATION_KEY?` | Embedded wallets + auth JWT |
| Twilio | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`, `TWILIO_WHATSAPP_FROM` | `AC...` / `SK...` regex enforced |
| LLM | `LLM_PROVIDER`, `MOONSHOT_API_KEY?`, `GROQ_API_KEY?`, `KIMI_MODEL` | Al menos uno de los dos API keys debe estar presente; cross-field refine |
| Helius | `HELIUS_API_KEY`, `HELIUS_WEBHOOK_SECRET?` | RPC + priority fee estimation |
| Postgres | `DATABASE_URL`, `DIRECT_URL?` | `DIRECT_URL` requerida para drizzle-kit migrations (bypasa PgBouncer) |
| Upstash | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | REST-based, no TCP |
| Internal auth | `INTERNAL_HMAC_SECRET` | Min 32 chars (256-bit) para HMAC agent→API |
| Service URLs | `API_URL`, `WA_URL`, `AGENT_URL`, `INDEXER_URL` | Internal service mesh |
| Observabilidad | `SENTRY_DSN?`, `BETTER_STACK_TOKEN?` | Opcionales en dev |
| App | `NODE_ENV`, `LOG_LEVEL` | Defaults: `development`, `info` |

### Ejemplo

```ts
import { env } from "@comadre/config";

// Acceso totalmente tipado; TypeScript sabe el tipo exacto de cada campo.
console.log(env.SOLANA_RPC_URL);   // string
console.log(env.SOLANA_CLUSTER);   // "devnet" | "mainnet-beta" | "testnet" | "localnet"

// Alternativa lazy (sin ejecutar validación al importar):
import { loadEnv } from "@comadre/config/loadEnv";
const e = loadEnv(); // valida una sola vez; cacheado en llamadas posteriores
```

### Dependencias

- Externas: `zod`, `picocolors`
- Internas: ninguna (es base)

### Gotchas

- La validación es **eager al importar** `env`. Si cualquier variable requerida falta o tiene formato inválido, el proceso termina con código 1 y un mensaje colorizado por campo.
- `@comadre/config` valida **todas** las variables. Usarlo en un contexto que sólo tiene Redis credentials (ej. tests de cache) fallará. En esos casos, leer `process.env` directamente o mockear el módulo.
- `llmSchema` usa `.refine()` cross-field: si `LLM_PROVIDER=groq` pero `GROQ_API_KEY` no está seteada, falla aunque `MOONSHOT_API_KEY` esté presente.
- No lee `.env` files — la inyección de variables es responsabilidad del runtime (Bun dev, Railway, Fly.io).

---

## @comadre/types

**Propósito**: schemas Zod compartidos para inputs de API, responses y webhooks entrantes. Son la fuente de verdad de la validación en el boundary HTTP. Consumido por `apps/api`, `apps/whatsapp`, `apps/agent`, `apps/indexer` y `@comadre/agent-tools`.

**Source**: `packages/types/src/`

### Exports

#### Inputs (`inputs.ts`) — request bodies de API

| Schema | Shape resumida | Endpoint |
|---|---|---|
| `SolanaPubkey` | `string` (base58, 32-44 chars) | Validador reutilizable |
| `E164Phone` | `string` (`+[1-9]\d{6,14}`) | Validador reutilizable |
| `CreateTandaInput` | `{ name, member_target(3-20), contribution_amount(bigint), stake_amount(bigint), frequency_seconds(≥86400), payout_order_mode, usdc_mint }` | `POST /api/v1/tandas` |
| `JoinTandaInput` | `{ tanda_id: SolanaPubkey }` | `POST /api/v1/tandas/:id/join` |
| `ContributeInput` | `{ tanda_id: SolanaPubkey }` | `POST /api/v1/tandas/:id/contribute` |
| `OpenDisputeInput` | `{ tanda_id: SolanaPubkey, reason(max 280 chars) }` | `POST /api/v1/disputes` |
| `VoteDisputeInput` | `{ dispute_id: SolanaPubkey, continue_tanda: boolean }` | `POST /api/v1/disputes/:id/vote` |
| `CreateUserProfileInput` | `{ phone_hash(sha256 hex 64 chars), country_code(ISO 3166-1 alpha-2 uppercase) }` | `POST /api/v1/users/init` |
| `LookupPhoneInput` | `{ phone: E164Phone }` | `GET /api/v1/transfers/lookup` |
| `CreateTransferInput` | `{ toPhone: E164Phone, amountUsdc(decimal string ≤6 decimales), note?(max 280) }` | `POST /api/v1/transfers` |

#### Responses (`responses.ts`) — response bodies de API

| Schema | Shape resumida |
|---|---|
| `UserProfileResponse` | `{ wallet, kyc_tier, reputation_score(0-1000), tandas_completed, tandas_defaulted, country_code }` |
| `TandaResponse` | `{ id, creator, name, state, member_target, member_current, contribution_amount(string), stake_amount(string), current_turn, total_turns, next_payout_ts, members[] }` |
| `MemberResponse` | `{ wallet, turn_number, contributions_made, has_received_payout, is_active }` |
| `UnsignedTransactionResponse` | `{ unsigned_tx(base64), idempotency_key(uuid) }` |
| `LookupResponse` | `{ phone, phoneHash, registered, wallet?, walletPreview?, kycTier? }` |
| `TransferResponse` | Discriminated union por `mode`: `"immediate"` (tiene `unsignedTxBase64`, expira en 5 min) o `"deferred"` (destinatario no registrado, expira en 7 días) |
| `ConfirmTransferResponse` | `{ signature, status: "confirmed", explorerUrl }` |

#### Tipos planos (sin valor Zod en exports)

- `KycTier`: `"t0_demo" \| "t1_lite" \| "t2_standard" \| "t3_pro"` — ordinal locked con on-chain `KycTier` enum
- `TandaState`: `"forming" \| "active" \| "paused" \| "completed" \| "cancelled"` — ordinal locked con on-chain `TandaState` enum

#### Webhooks (`webhooks.ts`) — payloads entrantes de servicios externos

| Schema | Evento | Notas |
|---|---|---|
| `SumsubWebhookEvent` | Discriminated union en `type`: `applicantReviewed`, `applicantPending`, `applicantOnHold`, `applicantActionPending` | `.strict()` por branch; `reviewResult` incluye `reviewAnswer: "GREEN" \| "RED"` |
| `TwilioInboundWebhook` | Mensaje entrante WhatsApp → nuestro webhook | `application/x-www-form-urlencoded`; `.passthrough()` para campos Media |
| `TwilioStatusCallback` | Delivery receipt de mensaje saliente | Estados: `queued \| sending \| sent \| delivered \| undelivered \| failed \| read \| received` |
| `HeliusWebhookEvent` | Transacción enhanced de Helius | `.passthrough()` para campos extras; incluye `tokenTransfers`, `nativeTransfers`, `accountData` |
| `HeliusWebhookPayload` | Array de `HeliusWebhookEvent` | Helius envía siempre un array por POST |

### Ejemplo

```ts
import { CreateTransferInput, TransferResponse } from "@comadre/types";

// Validar body entrante (runtime)
const input = CreateTransferInput.parse(req.body);

// Usar como tipo (compile-time only)
import type { CreateTransferInput } from "@comadre/types";
```

### Dependencias

- Externas: `zod`
- Internas: ninguna

### Gotchas

- Los montos en inputs usan `z.coerce.bigint()` — acepta `number` o `string` en JSON y coerce a `bigint`. Los montos en responses se devuelven como `string` para evitar pérdida de precisión.
- `amountUsdc` en `CreateTransferInput` es un string decimal (`"10.50"`), NO un entero. El API multiplica por 1 000 000 internamente.
- `payout_order_mode: "creator_set"` y `"random"` son aceptados por los schemas pero **rechazados en runtime por el programa Anchor** (`NotImplemented`). Ver gotchas de `@comadre/anchor-program`.
- `TransferResponse` es una discriminated union: siempre verificar `mode` antes de acceder a `unsignedTxBase64` (sólo existe en `mode="immediate"`).

---

## @comadre/db

**Propósito**: definición del schema Drizzle ORM (13 tablas Postgres + 11 enums nativos) y el cliente con connection pool. Las tablas en-chain son mirrors de los accounts Anchor (escritos por el indexer); las off-chain son estado exclusivo del backend.

**Source**: `packages/db/src/`

### Exports

#### Tablas

| Tabla | Qué guarda | Scope |
|---|---|---|
| `users` | Wallet (PK), phone_hash, country_code, kyc_tier, reputation_score, tandas_completed/defaulted/created, loans_repaid/defaulted | Mirror de `UserProfile` on-chain |
| `tandas` | PDA (PK), creator, tanda_id, name_hash, name (off-chain denormalized), vault, amounts, state, payout_order, next_payout_ts | Mirror de `Tanda` on-chain |
| `members` | PDA (PK), tanda_id, user_wallet, turn_number, contributions_made, stake_locked, is_active, has_received_payout | Mirror de `Member` on-chain |
| `disputes` | PDA (PK), tanda_id, dispute_id, opener_wallet, reason_hash, reason_text (off-chain plain text), votes_continue/cancel, state, deadline_ts | Mirror de `Dispute` on-chain + texto plain off-chain |
| `dispute_votes` | PDA (PK), dispute_id, voter_wallet, continue_tanda, voted_at | Mirror de `DisputeVote` on-chain |
| `loans` | PDA (PK), loan_id, borrower_wallet, tanda_backing?, principal, apr_bps, total_repaid, cosigner_count, state | Mirror de `Loan` on-chain (modelo mínimo, full deferred post-hackathon) |
| `loan_cosigners` | PDA (PK), loan_id, cosigner_wallet, stake_locked, has_signed | Mirror de `LoanCosigner` on-chain |
| `badges` | PDA (PK), badge_id, user_wallet, badge_type, source_account, value, earned_at | Mirror de `ReputationBadge` on-chain |
| `conversations` | UUID (PK), user_wallet?, phone_hash, channel, messages (JSONB), state (JSONB) | Off-chain — estado de conversación del agente (WhatsApp/web) |
| `idempotency_keys` | key (PK), user_wallet, endpoint, status_code, response_body (JSONB), expires_at (24h) | Off-chain — replay protection; limpiado por cron |
| `ramps` | UUID (PK), user_wallet, direction, provider, fiat_currency, fiat_amount_cents, usdc_amount, status, provider_ref | Off-chain — onramp/offramp records |
| `kyc_sessions` | UUID (PK), user_wallet, applicant_id, level_name, status, review_answer | Off-chain — sesiones Sumsub KYC |
| `transfers` | UUID (PK), sender/recipient wallets y phone_hashes, amount_micro_usdc, note, status, tx_signature, expires_at | Off-chain — ledger de P2P transfers (locking intencional off-chain) |

#### Enums Postgres (pgEnum)

| Enum | Valores |
|---|---|
| `kycTierEnum` | `t0_demo`, `t1_lite`, `t2_standard`, `t3_pro` |
| `tandaStateEnum` | `forming`, `active`, `paused`, `completed`, `cancelled` |
| `payoutOrderEnum` | `join_order`, `creator_set`, `random` |
| `disputeStateEnum` | `open`, `resolved_continue`, `resolved_cancel`, `expired` |
| `badgeTypeEnum` | `tanda_completed`, `tanda_created_and_completed`, `loan_repaid_on_time`, `dispute_resolved_fairly` |
| `channelEnum` | `whatsapp`, `web` |
| `rampDirectionEnum` | `onramp`, `offramp` |
| `rampStatusEnum` | `pending`, `quoted`, `confirmed`, `completed`, `failed` |
| `loanStateEnum` | `pending`, `active`, `repaid`, `defaulted` |
| `kycSessionStatusEnum` | `init`, `pending`, `approved`, `rejected`, `on_hold` |
| `transferStatusEnum` | `pending`, `awaiting_recipient`, `confirmed`, `expired`, `cancelled`, `failed` |

#### Cliente

| Symbol | Tipo | Qué hace |
|---|---|---|
| `db` | `DrizzleInstance` (Proxy) | Singleton lazy; la primera propiedad accedida inicializa el pool. |
| `getDb()` | `() => DrizzleInstance` | Getter explícito; equivalente a `db` pero más claro en código de tests. |
| `closeDb()` | `() => Promise<void>` | Cierra el pool `postgres-js`. Llamar en handlers `SIGTERM`/`SIGINT`. |

### Ejemplo

```ts
import { db, users, tandas } from "@comadre/db";
import { eq } from "drizzle-orm";

// Query tipada con Drizzle
const user = await db.select().from(users).where(eq(users.wallet, walletPubkey));

// Cerrar pool al shutdown
process.on("SIGTERM", async () => {
  await closeDb();
  process.exit(0);
});
```

### Dependencias

- Externas: `drizzle-orm`, `postgres`
- Internas: `@comadre/config`

### Gotchas

- El pool usa `prepare: false` — **obligatorio** para PgBouncer en modo transaction-pooling (Supabase free tier). Prepared statements no son soportados.
- Todos los campos `u64` on-chain se almacenan como `BIGINT mode:'bigint'` — devuelven `BigInt` de JS, no `number`. El consumer debe manejarlo con `BigInt()` o `.toString()`.
- `disputeStateEnum` tiene `resolved_continue` / `resolved_cancel` en lugar del `Resolved` del programa Anchor. **El indexer debe discriminar el outcome antes de insertar** — nunca escribir el variant raw del on-chain.
- El `db` Proxy es safe para imports múltiples — el pool se crea una sola vez. Pero no sobrevive a `closeDb()` sin reinicializar.

---

## @comadre/cache

**Propósito**: helpers de Redis (Upstash REST) para idempotencia de POSTs, rate limiting por sliding window, y gestión del ventana de 24 horas de WhatsApp.

**Source**: `packages/cache/src/`

### Exports

#### Cliente Redis

| Symbol | Qué hace |
|---|---|
| `getRedis()` | Devuelve el singleton Redis. **Doble proxy lazy**: el módulo no hace nada al importar; `getRedis()` devuelve un objeto inmediatamente (sin network); la primera operación Redis lee las env vars y lanza el request HTTP. Seguro importar sin `UPSTASH_*` vars en tests. |

#### Idempotency cache (`idempotency.ts`)

| Symbol | Firma | Qué hace |
|---|---|---|
| `withIdempotency<T>` | `(key, handler, opts?) => Promise<T>` | Cache miss → ejecuta handler y guarda resultado; cache hit → devuelve `cached.body as T` sin ejecutar handler. TTL default 24h. |
| `getIdempotent` | `(key) => Promise<CachedResponse \| null>` | Low-level read. Devuelve `{ status, body }` o `null`. |
| `setIdempotent` | `(key, response, ttl?) => Promise<void>` | Low-level write con TTL. |
| `CachedResponse` | tipo | `{ status: number; body: unknown }` |

#### Rate limiting (`rateLimit.ts`)

| Symbol | Config | Descripción |
|---|---|---|
| `apiUserRateLimit` | 100 req / 1 min | REST API general, por usuario |
| `agentToolRateLimit` | 30 calls / 1 h | Loop de tools del agente Kimi, por usuario |
| `webhookRateLimit` | 60 req / 1 min | Webhook WhatsApp inbound, por número de teléfono |
| `createRateLimiter(prefix, config)` | — | Factory para crear limiters custom con sliding window |
| `checkRateLimit(limiter, id)` | — | Devuelve `{ allowed, remaining, resetAt }` |

#### WhatsApp 24h window (`waWindow.ts`)

| Symbol | Firma | Qué hace |
|---|---|---|
| `hashPhone(e164)` | `(string) => Promise<string>` | SHA-256 hex de un número E.164. Valida formato; lanza si no es E.164 válido. Usa Web Crypto API (Bun + Node). |
| `recordInbound(phoneHash)` | `(string) => Promise<void>` | Registra que el usuario mandó un mensaje ahora. Resetea el TTL a 24h + 60s epsilon. |
| `isWithinWindow(phoneHash)` | `(string) => Promise<boolean>` | `true` si la clave Redis existe (ventana abierta). |
| `getWindowExpiry(phoneHash)` | `(string) => Promise<Date \| null>` | Fecha de cierre nominal de la ventana (descuenta el epsilon). `null` si ya expiró. |

### Ejemplo

```ts
import { withIdempotency, apiUserRateLimit, checkRateLimit, hashPhone, isWithinWindow } from "@comadre/cache";

// Idempotencia en un POST
const result = await withIdempotency(req.headers["x-idempotency-key"], () => createTandaOnChain(input));

// Rate limiting
const { allowed } = await checkRateLimit(apiUserRateLimit, userWallet);
if (!allowed) return new Response("Too Many Requests", { status: 429 });

// WhatsApp window
const hash = await hashPhone("+5491112345678");
if (!(await isWithinWindow(hash))) {
  // Usar template message en lugar de free-form
}
```

### Dependencias

- Externas: `@upstash/redis`, `@upstash/ratelimit`
- Internas: ninguna (lee `process.env` directamente para evitar validar todo el schema de config)

### Gotchas

- `withIdempotency` tiene una **race condition best-effort** entre el GET y el SET: dos requests concurrentes con la misma key pueden ambas ejecutar el handler. La garantía de idempotencia real la da el programa Anchor via PDA uniqueness. Para serialización estricta, usar un advisory lock en Postgres antes de llamar `withIdempotency`.
- `hashPhone` lanza un `Error` sincrónico si el input no es E.164 válido. Normaliza whitespace (trim) antes de validar.
- Los rate limiters usan sliding window de `@upstash/ratelimit` — más preciso que fixed window pero consume más Redis ops por request.
- `getRedis()` **no** usa `@comadre/config` para leer las env vars — diseño intencional para no forzar la validación del schema completo en contextos que solo necesitan Redis.

---

## @comadre/anchor-client

**Propósito**: bindings TypeScript tipados para el programa Comadre en Solana. Exporta el Program ID, mints USDC, 10 derivadores de PDA y el factory `getComadreProgram`. No contiene lógica de negocio — es puramente infrastructure plumbing.

**Source**: `packages/anchor-client/src/`

### Exports

#### Identifiers (`programId.ts`)

| Symbol | Valor | Qué hace |
|---|---|---|
| `COMADRE_PROGRAM_ID` | `PublicKey("BfVXncFhJdSsDciLx7UzVjFbEBw1EtcnJCsYSRis54Sh")` | Program ID actual (devnet). Lee de `env.COMADRE_PROGRAM_ID`. |
| `USDC_MINT_DEVNET` | `PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU")` | USDC faucet token en devnet |
| `USDC_MINT_MAINNET` | `PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")` | USDC real en mainnet |
| `getUsdcMint()` | `() => PublicKey` | Devuelve el mint correcto según `env.SOLANA_CLUSTER`. |

#### Semillas (`seeds.ts`)

| Symbol | Valores | Notas |
|---|---|---|
| `SEEDS` | `{ USER, TANDA, MEMBER, VAULT, DISPUTE, DISPUTE_VOTE, LOAN, COSIGNER, BADGE, CONFIG }` | Buffers que coinciden byte-a-byte con `constants.rs`. Cambiar uno rompe silenciosamente la derivación. |
| `PROGRAM_LIMITS` | `{ MAX_MEMBERS: 20, MAX_NAME_LEN: 32, MAX_DISPUTES_PER_TANDA: 5, DISPUTE_VOTING_WINDOW_SECONDS: 604800, SLASH_GRACE_SECONDS: 86400 }` | Constantes del programa para validación client-side |

#### Derivadores de PDA (`pdas.ts`)

Todos reciben `programId?: PublicKey` (default `COMADRE_PROGRAM_ID`) y devuelven `readonly [PublicKey, number]`.

| Función | Seeds | PDA |
|---|---|---|
| `deriveConfigPda()` | `[CONFIG]` | Singleton `ProgramConfig` |
| `deriveUserProfilePda(wallet)` | `[USER, wallet]` | `UserProfile` del usuario |
| `deriveTandaPda(creator, tandaId)` | `[TANDA, creator, tanda_id_le8]` | `Tanda` account |
| `deriveMemberPda(tanda, user)` | `[MEMBER, tanda, user]` | `Member` account |
| `deriveVaultPda(tanda)` | `[VAULT, tanda]` | Token account PDA-owned de la tanda |
| `deriveDisputePda(tanda, disputeId)` | `[DISPUTE, tanda, dispute_id_u8]` | `Dispute` account |
| `deriveDisputeVotePda(dispute, voter)` | `[DISPUTE_VOTE, dispute, voter]` | `DisputeVote` account |
| `deriveLoanPda(borrower, loanId)` | `[LOAN, borrower, loan_id_le8]` | `Loan` account |
| `deriveCosignerPda(loan, cosigner)` | `[COSIGNER, loan, cosigner]` | `LoanCosigner` account |
| `deriveBadgePda(user, badgeId)` | `[BADGE, user, badge_id_le8]` | `ReputationBadge` account |

#### Program factory (`program.ts`)

| Symbol | Qué hace |
|---|---|
| `getComadreProgram(connection, wallet)` | Retorna `Program<Comadre>` tipado con Anchor. Para contextos read-only (indexer), pasar un `NodeWallet(Keypair.generate())` dummy. |
| `IDL` | Raw IDL JSON como `Comadre`. Para instanciar el programa sin wallet. |

### Ejemplo

```ts
import { deriveTandaPda, getComadreProgram, getUsdcMint } from "@comadre/anchor-client";
import { getConnection } from "@comadre/solana";
import { NodeWallet } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";

const program = getComadreProgram(getConnection(), new NodeWallet(Keypair.generate()));
const [tandaPda] = deriveTandaPda(creatorPubkey, BigInt(0));
const tandaAccount = await program.account.tanda.fetch(tandaPda);
```

### Dependencias

- Externas: `@coral-xyz/anchor`, `@solana/web3.js`
- Internas: `@comadre/config`

### Gotchas

- `COMADRE_PROGRAM_ID` se inicializa **al importar el módulo** (llama `env.COMADRE_PROGRAM_ID`). En tests que no tienen todas las env vars, esto puede fallar. Mockear `@comadre/config` o setear la var.
- `tandaId` y `loanId` son `bigint` — se encodean en little-endian de 8 bytes (`u64Le`). Usar siempre `BigInt()`, no `number`, para evitar overflow.
- `deriveDisputePda` valida que `disputeId` esté en `[0, 255]` (es `u8` on-chain). Lanza `RangeError` si no.

---

## @comadre/solana

**Propósito**: infraestructura de transacciones Solana para los servicios backend. Manejo de keypairs, connection singleton, estimación de priority fees via Helius, construcción de `VersionedTransaction` parcialmente firmadas y submit con retry + detección de blockhash expirado.

**Source**: `packages/solana/src/`

### Exports

#### Keypairs (`feePayer.ts`)

Todos los getters cachean el resultado en `Map<string, Keypair>` — decodifican base58 solo en la primera llamada.

| Función | Variable de env | Rol |
|---|---|---|
| `getFeePayerKeypair()` | `FEE_PAYER_SK` | Paga fees SOL y rent en nombre de los usuarios |
| `getCrankAuthorityKeypair()` | `CRANK_AUTHORITY_SK` | Firma cranks no-financieros: `payout`, `complete_tanda`, `slash_defaulter`, `resolve_dispute` |
| `getKycOracleKeypair()` | `KYC_ORACLE_SK` | Firma `update_kyc_tier` cuando Sumsub retorna veredicto |
| `getAdminKeypair()` | `ADMIN_SK` | Admin del programa: `init_config`, `pause`/`unpause`. Mutar a Squads multisig en mainnet. |
| `_resetKeypairCache()` | — | Test-only: limpia el cache para poder recargar env vars. |

#### Connection (`connection.ts`)

| Función | Qué hace |
|---|---|
| `getConnection()` | Singleton `Connection` con `commitment: "confirmed"` y WebSocket. Lee `SOLANA_RPC_URL` / `SOLANA_WS_URL` en la primera llamada. |
| `resetConnection()` | Nullea el singleton. Útil en tests para cambiar de endpoint entre casos. |

#### Priority fee (`priorityFee.ts`)

| Función | Firma | Qué hace |
|---|---|---|
| `getPriorityFeeMicroLamports(accountKeys, level?)` | `(string[], PriorityLevel?) => Promise<number>` | Llama `getPriorityFeeEstimate` de Helius RPC con las account keys de la tx. Si el call falla o el RPC no es Helius, retorna el fallback de **1000 microLamports/CU**. `level` default: `"Medium"`. |

`PriorityLevel`: `"Min" \| "Low" \| "Medium" \| "High" \| "VeryHigh" \| "UnsafeMax"`

#### Transaction builder (`txBuilder.ts`)

```ts
buildUnsignedTx(params: BuildUnsignedTxParams): Promise<UnsignedTxResult>
```

`BuildUnsignedTxParams`:
- `instructions: TransactionInstruction[]` — instrucciones Anchor en orden
- `payer?: Keypair` — default `getFeePayerKeypair()`
- `signers?: Keypair[]` — signers backend adicionales (ej. `crank_authority`)
- `computeUnits?: number` — default `200_000`
- `priorityLevel?: PriorityLevel` — default `"Medium"`
- `connection?: Connection` — override para tests

`UnsignedTxResult`:
- `unsignedTxBase64: string` — `VersionedTransaction` serializado en base64, parcialmente firmado por el backend
- `recentBlockhash: string` — blockhash baked en el mensaje
- `estimatedFeeLamports: number` — `priorityFee + 5000` (base fee fija)

El builder: agrega `SetComputeUnitLimit` + `SetComputeUnitPrice` automáticamente, obtiene el blockhash, sign con `payer` y `signers`, serializa y devuelve base64.

#### Submit con retry (`retry.ts`)

```ts
submitWithRetry(tx: VersionedTransaction, opts?: SubmitOptions): Promise<SubmitResult>
```

- `maxAttempts` default 3; `initialDelayMs` default 500ms; backoff exponencial (500 → 1000 → 2000ms)
- Detecta blockhash expirado (`"blockhash not found"`, `"BlockhashNotFound"`, `"block height exceeded"`) y lanza un error diferenciado para que el caller reconstruya la tx
- **No usado por `apps/api`** — la API devuelve txs sin firmar y el usuario broadcastea. Sí usado por `apps/cron` e indexer.

### Ejemplo

```ts
import { buildUnsignedTx, getFeePayerKeypair, getCrankAuthorityKeypair, submitWithRetry } from "@comadre/solana";

// apps/api — construir tx sin firmar para el usuario
const { unsignedTxBase64 } = await buildUnsignedTx({ instructions: [joinIx] });

// apps/cron — ejecutar un crank directamente
const { unsignedTxBase64 } = await buildUnsignedTx({
  instructions: [payoutIx],
  signers: [getCrankAuthorityKeypair()],
});
const tx = VersionedTransaction.deserialize(Buffer.from(unsignedTxBase64, "base64"));
const { signature } = await submitWithRetry(tx);
```

### Dependencias

- Externas: `@solana/web3.js`, `@coral-xyz/anchor`, `@solana/spl-token`, `bs58`
- Internas: `@comadre/config`, `@comadre/anchor-client`

### Gotchas

- Los keypairs se validan que tengan exactamente 64 bytes post-decode. Un secret key de 32 bytes (sólo privkey, sin pubkey concatenada) fallará.
- `buildUnsignedTx` incluye el **fee_payer como primer firmante** — el tx ya está parcialmente firmado. Si el usuario también es payer (caso raro), no re-setear el campo.
- El fallback de priority fee (1000 microLamports) es conservador para devnet. En mainnet congestionado puede resultar en txs dropped. Considerar elevar el nivel a `"High"` en producción.

---

## @comadre/agent-tools

**Propósito**: 14 tools en formato OpenAI-compatible (para Kimi vía Moonshot/Groq) que el agente WhatsApp usa. Cada tool tiene una `Definition` (schema JSON) y un `Execute` (implementación que llama `apps/api` via HMAC). El package es el único punto de contacto entre el agente y la API.

**Source**: `packages/agent-tools/src/`

### Exports

#### Catálogo de tools

| # | Nombre | Descripción | Params | Endpoint REST |
|---|---|---|---|---|
| 1 | `consultar_perfil` | Perfil del usuario: KYC, reputación, tandas completadas | ninguno | `GET /api/v1/users/me` |
| 2 | `consultar_tanda` | Detalles de una tanda específica | `tanda_id` | `GET /api/v1/tandas/:id` |
| 3 | `crear_tanda` | Crear nueva tanda; devuelve unsigned tx | `name, member_target, contribution_amount_cents, frequency_days, payout_order_mode` | `POST /api/v1/tandas` |
| 4 | `unirse_tanda` | Unirse a tanda; devuelve unsigned tx | `tanda_id` | `POST /api/v1/tandas/:id/join` |
| 5 | `aportar_turno` | Hacer el aporte del turno actual; devuelve unsigned tx | `tanda_id` | `POST /api/v1/tandas/:id/contribute` |
| 6 | `abrir_disputa` | Abrir disputa y pausar la tanda; devuelve unsigned tx | `tanda_id, reason` | `POST /api/v1/tandas/:id/disputes` |
| 7 | `votar_disputa` | Votar en disputa abierta; devuelve unsigned tx | `dispute_id, continue_tanda` | `POST /api/v1/disputes/:id/vote` |
| 8 | `solicitar_kyc` | Iniciar/avanzar proceso KYC Sumsub | ninguno | `POST /api/v1/kyc/session` |
| 9 | `iniciar_onramp` | Cotizar compra de USDC en fiat (mock) | `fiat_currency, amount_cents` | `POST /api/v1/onramp/quote` |
| 10 | `consultar_balance` | Saldo/stats del usuario (proxy via perfil en MVP) | ninguno | `GET /api/v1/users/me` |
| 11 | `iniciar_transfer` | Iniciar P2P transfer vía WhatsApp; immediate o deferred | `to_phone, amount_usdc, note?` | `POST /api/v1/transfers` |
| 12 | `confirmar_transfer` | Confirmar y ejecutar transfer on-chain | `transfer_id` | `POST /api/v1/transfers/:id/confirm` |
| 13 | `cancelar_transfer` | Cancelar transfer pendiente | `transfer_id` | `POST /api/v1/transfers/:id/cancel` |
| 14 | `iniciar_onboarding` | Crear wallet Privy embedded para el usuario | ninguno (usa `context.senderPhone`) | `POST /api/v1/onboarding/init` |

#### API de entrada pública

| Symbol | Qué hace |
|---|---|
| `ALL_TOOLS` | `readonly ToolDefinition[]` — todas las definitions en orden; pasar directamente a `client.chat.completions.create({ tools: ALL_TOOLS })` |
| `TOOL_EXECUTORS` | `Record<string, ToolExecutor>` — mapa nombre → implementación |
| `executeTool(name, args, context)` | Dispatcher principal: busca el executor, lo llama, captura errores y retorna `ToolResult` |
| `apiCall<T>(params)` | HTTP client interno con HMAC; requerido para POSTs que incluyan `idempotencyKey` |
| `newIdempotencyKey()` | Genera UUID v4 para idempotency keys |

#### Tipos

| Tipo | Shape |
|---|---|
| `ToolContext` | `{ userWallet: string; senderPhone?: string; idempotencyKey?: string }` |
| `ToolResult` | Discriminated union: `{ type: "data"; data; summary? }` \| `{ type: "unsigned_tx"; unsigned_tx_base64; idempotency_key; summary }` \| `{ type: "error"; error }` |
| `ToolDefinition` | Schema OpenAI-compatible: `{ type: "function"; function: { name, description, parameters } }` |

### Ejemplo

```ts
import { ALL_TOOLS, executeTool } from "@comadre/agent-tools";

// Pasar todas las tools a Kimi
const completion = await client.chat.completions.create({
  model: env.KIMI_MODEL,
  messages,
  tools: ALL_TOOLS,
});

// Ejecutar cada tool call
for (const call of completion.choices[0].message.tool_calls ?? []) {
  const result = await executeTool(
    call.function.name,
    JSON.parse(call.function.arguments),
    { userWallet, senderPhone }
  );
  if (result.type === "unsigned_tx") {
    // Entregar la tx al usuario para que firme
  }
}
```

### Dependencias

- Externas: ninguna (sólo node `crypto`)
- Internas: `@comadre/config`, `@comadre/types`

### Gotchas

- El cliente HTTP (`apiCall`) usa HMAC-SHA256 con `INTERNAL_HMAC_SECRET`. Payload firmado: `METHOD\nPATH\nTIMESTAMP\nBODY`. `apps/api` valida la signature en cada request interno.
- En dev (`NODE_ENV !== "production"`) se incluyen headers `X-Dev-Wallet` y `X-Dev-User-Id` para el bypass de auth de Privy en la API.
- **Los POSTs siempre requieren `idempotencyKey`** — `apiCall` lanza si se omite en un POST. Usar `context.idempotencyKey ?? newIdempotencyKey()`.
- `iniciar_transfer` devuelve `type: "data"` en ambos modos (immediate y deferred) — el LLM debe leer `result.data.mode` para saber si hay una tx para firmar o si es el caso deferred.
- La tool `iniciar_onboarding` requiere `context.senderPhone` — falla con `type: "error"` si no está en el contexto.
- Los amounts en `crear_tanda` se reciben en **centavos** (`contribution_amount_cents`) y el executor convierte a micro-USDC multiplicando por `10_000n`.

---

## @comadre/anchor-program

**Propósito**: el smart contract Rust/Anchor desplegado en Solana. Define todas las instrucciones, state accounts, eventos, errores y constantes del protocolo Comadre.

**Source**: `packages/anchor-program/programs/comadre/src/`
**Program ID**: `BfVXncFhJdSsDciLx7UzVjFbEBw1EtcnJCsYSRis54Sh` (devnet actual)

> Este package es Rust — no se importa como dependency TypeScript. El cliente TS interactúa vía `@comadre/anchor-client` (IDL generado por `anchor build`).

### Instrucciones (15 total)

| Instrucción | Descripción | Signer(s) | Cuentas clave |
|---|---|---|---|
| `init_user_profile` | Inicializa `UserProfile` PDA con phone_hash y country_code. KYC tier inicial: `T0Demo`. | `payer` (fee payer) | `user_profile` (init), `wallet` (CHECK), `system_program` |
| `update_kyc_tier` | Actualiza el tier KYC de un usuario. Requiere que `kyc_oracle` sea el key configurado en `ProgramConfig`. | `kyc_oracle` | `user_profile` (mut), `program_config`, `wallet` |
| `create_tanda` | Crea `Tanda` PDA + `vault` token account. Valida KYC ≥ T1Lite, member_target en [3,20], frequency ≥ 24h. | `creator` | `creator_profile`, `program_config`, `tanda` (init), `vault` (init), `usdc_mint` |
| `join_tanda` | Une un usuario a una tanda en estado Forming. Transfiere el `stake_amount` del ATA del usuario al vault. | `user` | `user_profile`, `program_config`, `tanda` (mut), `member` (init), `user_usdc_ata` (mut), `vault` (mut) |
| `start_tanda` | Transiciona de Forming → Active. Requiere `member_current == member_target`. Sólo `JoinOrder` habilitado en MVP (ver caveats). | `creator` | `tanda` (mut), `program_config` |
| `contribute` | Registra el aporte del turno actual. Transfiere `contribution_amount` del ATA del miembro al vault. | `user` | `tanda` (mut), `member` (mut), `user_usdc_ata` (mut), `vault` (mut) |
| `payout` | Ejecuta el payout al beneficiario del turno actual. Sólo cuando todos los miembros aportaron y `next_payout_ts` llegó. | `crank_authority` | `tanda` (mut), `member` (mut, beneficiary), `vault` (mut), `beneficiary_usdc_ata` (mut) |
| `complete_tanda` | Cierra la tanda después del último payout. Transiciona a Completed. Devuelve stakes restantes. | `crank_authority` | `tanda` (mut), `program_config` |
| `slash_defaulter` | Confisca el stake de un miembro que no contribuyó dentro del grace period (24h post deadline). | `crank_authority` | `tanda` (mut), `member` (mut), `vault` (mut), `program_config` |
| `open_dispute` | Abre una `Dispute` contra la tanda. Pausa la tanda. Crea ventana de votación de 7 días. | `opener` (member) | `dispute` (init), `tanda` (mut), `opener_member`, `program_config` |
| `vote_dispute` | Emite un voto en una disputa abierta. Crea `DisputeVote` PDA. | `voter` (member) | `dispute_vote` (init), `dispute` (mut), `voter_member`, `program_config` |
| `resolve_dispute` | Resuelve disputa expirada según mayoría de votos. Reactiva o cancela la tanda. | `crank_authority` | `dispute` (mut), `tanda` (mut), `program_config` |
| `init_config` | Inicializa el singleton `ProgramConfig`. Sólo puede llamarlo `INITIAL_DEPLOYER`. | `authority` (= `INITIAL_DEPLOYER`) | `program_config` (init), `system_program` |
| `pause` | Activa o desactiva el flag `paused` en `ProgramConfig`. | `admin` | `program_config` (mut) |

> **Nota**: `init_user_profile_implicit` NO existe en el código actual. Son 15 instrucciones, no 16.

### State accounts

| Account | PDA seeds | Descripción |
|---|---|---|
| `ProgramConfig` | `[CONFIG]` | Singleton: admin, kyc_oracle, crank_authority, usdc_mint, fee_bps, fee_destination, kyc_limits[4], paused |
| `UserProfile` | `[USER, wallet]` | Por wallet: phone_hash, country_code, kyc_tier, reputation_score, estadísticas de tandas y loans |
| `Tanda` | `[TANDA, creator, tanda_id_le8]` | Por tanda: creator, parámetros, estado, vault ref, turno actual, timestamps |
| `Member` | `[MEMBER, tanda, user]` | Por miembro en tanda: turn_number, contributions_made, stake_locked, is_active, has_received_payout |
| `Dispute` | `[DISPUTE, tanda, dispute_id_u8]` | Por disputa: opener, reason_hash, votes_continue/cancel, state, deadline_ts |
| `DisputeVote` | `[DISPUTE_VOTE, dispute, voter]` | Por voto: continue_tanda, voted_at |
| `Loan` | `[LOAN, borrower, loan_id_le8]` | Por loan: principal, apr_bps, tanda_backing, cosigner_count, state (mínimo, post-hackathon) |
| `LoanCosigner` | `[COSIGNER, loan, cosigner]` | Por cosigner: stake_locked, has_signed |
| `ReputationBadge` | `[BADGE, user, badge_id_le8]` | Por badge: badge_type, source_account, value, earned_at |

### Eventos (13 total)

| Evento | Campos | Cuándo se emite |
|---|---|---|
| `UserProfileInitialized` | `wallet, phone_hash, country_code, timestamp` | `init_user_profile` exitoso |
| `KycTierUpdated` | `wallet, new_tier(u8), timestamp` | `update_kyc_tier` exitoso |
| `TandaCreated` | `tanda, creator, member_target, contribution_amount, timestamp` | `create_tanda` exitoso |
| `MemberJoined` | `tanda, user, turn_number, timestamp` | `join_tanda` exitoso |
| `TandaStarted` | `tanda, timestamp` | `start_tanda` exitoso |
| `ContributionMade` | `tanda, user, turn(u8), amount, timestamp` | `contribute` exitoso |
| `PayoutExecuted` | `tanda, beneficiary, turn(u8), amount, timestamp` | `payout` exitoso |
| `TandaCompleted` | `tanda, timestamp` | `complete_tanda` exitoso |
| `MemberSlashed` | `tanda, member, stake_lost, timestamp` | `slash_defaulter` exitoso |
| `DisputeOpened` | `dispute, tanda, opener, timestamp` | `open_dispute` exitoso |
| `DisputeVoted` | `dispute, voter, continue_tanda, timestamp` | `vote_dispute` exitoso |
| `DisputeResolved` | `dispute, continue_tanda, timestamp` | `resolve_dispute` exitoso |
| `BadgeMinted` | `user, badge_type(u8), source, value, timestamp` | Al mintear una badge |

### Errores (30 total)

| Código | Nombre | Cuándo se emite |
|---|---|---|
| 6000 | `InsufficientKyc` | KYC tier demasiado bajo para la acción |
| 6001 | `TandaNotForming` | Se intenta join/start en tanda que no está en Forming |
| 6002 | `TandaNotActive` | Se intenta contribute/payout en tanda no Active |
| 6003 | `TandaPaused` | La tanda está pausada por dispute |
| 6004 | `TandaFull` | Se intenta join cuando member_current == member_target |
| 6005 | `InvalidMemberCount` | member_target fuera de [3, 20] o start_tanda con count != target |
| 6006 | `TurnAlreadyTaken` | (CreatorSet) el turn_number elegido ya está ocupado |
| 6007 | `AlreadyContributed` | El miembro ya contribuyó en el turno actual |
| 6008 | `PayoutNotReady` | `next_payout_ts` aún no llegó |
| 6009 | `MissingContributions` | No todos los miembros activos contribuyeron |
| 6010 | `DisputeStillOpen` | Se intenta resolver dispute antes de que expire el voting window |
| 6011 | `AlreadyVoted` | El miembro ya votó en este dispute |
| 6012 | `NotAMember` | Caller no es miembro de la tanda |
| 6013 | `NotCreator` | Sólo el creador puede llamar `start_tanda` |
| 6014 | `Unauthorized` | Caller no tiene el rol requerido (admin, crank, kyc_oracle) |
| 6015 | `ProgramPaused` | El programa está pausado via `pause(true)` |
| 6016 | `MathOverflow` | Overflow en checked arithmetic |
| 6017 | `InvalidStake` | `stake_amount` o `contribution_amount` es 0 |
| 6018 | `InvalidFeeBps` | `fee_bps > 10000` en `init_config` |
| 6019 | `InvalidKycLimits` | `kyc_limits[0] == 0` o el array no es monotónico no-decreciente |
| 6020 | `InvalidFrequency` | `frequency_seconds < 86400` (24h mínimo) |
| 6021 | `KycInsufficientForAmount` | KYC tier insuficiente para el monto contribution + stake |
| 6022 | `MemberInactive` | El miembro fue slasheado (`is_active = false`) |
| 6023 | `AlreadyPaidOut` | El beneficiario ya recibió su payout |
| 6024 | `NotImplemented` | Modo de payout `CreatorSet` o `Random` en `start_tanda` |
| 6025 | `DisputeNotOpen` | Se intenta votar en dispute que no está en Open |
| 6026 | `DisputeExpired` | Se intenta votar en dispute ya expirado |
| 6027 | `DisputeNotExpired` | Se intenta resolver dispute antes de que expire |
| 6028 | `MemberNotDefaulted` | El miembro no está en default (contribuciones al día o grace period no pasó) |
| 6029 | `MaxDisputesReached` | La tanda ya tiene 5 disputes (`MAX_DISPUTES_PER_TANDA`) |

### Constantes

| Constante | Valor | Descripción |
|---|---|---|
| `MAX_MEMBERS` | `20` | Máximo de miembros por tanda |
| `MAX_NAME_LEN` | `32` | Máximo bytes del nombre de tanda |
| `MAX_DISPUTES_PER_TANDA` | `5` | Máximo disputes por tanda |
| `DISPUTE_VOTING_WINDOW_SECONDS` | `604800` (7 días) | Duración de la ventana de votación |
| `SLASH_GRACE_SECONDS` | `86400` (24h) | Grace period post deadline antes de poder slashear |
| `USDC_MINT` | devnet: `4zMMC9...` / mainnet: `EPjFWdd...` | Seleccionado por feature flag `devnet` en `Cargo.toml` |
| `INITIAL_DEPLOYER` | `11111111111111111111111111111111` (System Program placeholder) | **Placeholder** — debe reemplazarse con el pubkey real antes del deploy en mainnet |

### Caveats

- **`CreatorSet` y `Random` payout orders están hard-rejected** en `start_tanda` vía `require!(payout_order_mode == JoinOrder, NotImplemented)`. `CreatorSet` no tiene uniqueness check en join (dos miembros pueden tomar el mismo turno). `Random` requeriría VRF (Chainlink o commit-reveal). Sólo `JoinOrder` funciona en MVP.

- **`INITIAL_DEPLOYER` es el System Program** (`1111...`). Esta dirección no puede firmar nada, por lo que `init_config` actualmente es callable por cualquiera en localnet (hay un comment `// TODO` en el código). La feature `localnet` es lo que bypassa este guard en desarrollo. **Reemplazar antes de deploy en mainnet.**

- **`USDC_MINT` está gated por feature flag** `devnet` en Cargo. El build de mainnet no tiene la feature habilitada y usa la mint real. El TS client (`@comadre/anchor-client`) replica esta lógica via `env.SOLANA_CLUSTER`.

- **El programa no tiene `unpause` como instrucción separada**: `pause(ctx, false)` es el mecanismo (el bool `paused` es un toggle).
