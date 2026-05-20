# Data Model

> **Phase 1 — Monad migration**: el estado on-chain ahora vive en el contrato Solidity `Comadre.sol` (Monad), no más en cuentas Anchor (Solana). El DB Postgres es el espejo off-chain. Ver `packages/monad-contracts/src/Comadre.sol` para el contrato canónico.

## On-chain (Solidity mappings en Comadre.sol)

| Mapping | Clave | Descripción |
|---|---|---|
| `_userProfiles[wallet]` | `address` | `UserProfile { exists, phoneHash, countryCode, kycTier, reputationScore, tandasCreated/Completed/Defaulted }` |
| `_tandas[tandaKey]` | `bytes32 = keccak256(creator, tandaId)` | `Tanda { exists, creator, name, vault, members, contributionAmount, turn, state, ... }` |
| `_members[memberKey]` | `bytes32 = keccak256(tandaKey, user)` | `Member { exists, user, turnNumber, contributionsMade, stake, isActive, hasReceivedPayout }` |
| `_disputes[disputeKey]` | `bytes32 = keccak256(tandaKey, disputeId)` | `Dispute { exists, tandaKey, opener, votes, deadlineTs, state }` |
| `memberByTurn[tandaKey][turnNumber]` | `bytes32 + uint8` | Helper: turn → user wallet |
| `hasVoted[disputeKey][voter]` | `bytes32 + address` | Anti-double-vote |
| `kycLimits` | `uint64[4]` | Caps por tier T0Demo/T1Lite/T2Standard/T3Pro en micro-USDC. Inmutable post-construcción. |
| `paused` | `bool` | Emergency stop |
| `feeBps` | `uint16` | Fee en basis points (max `MAX_FEE_BPS = 300` = 3%) |

## Enums (Solidity)

```solidity
enum TandaState { Forming, Active, Paused, Completed, Cancelled }
enum KycTier { T0Demo, T1Lite, T2Standard, T3Pro }
enum DisputeState { Open, Resolved, Expired }
enum PayoutOrder { JoinOrder, CreatorSet }
```

Loans y badges no están implementados en Solidity (eran Solana-legacy).

## Decisiones cerradas

| Decisión | Valor | Razón |
|---|---|---|
| Stake-to-join | SÍ, 1x contribution | Único enforcement real contra defaults |
| Payout order MVP | `CreatorSet` | Refleja realidad de tandas IRL |
| Rent del backend | Sí en MVP | Invisible al user, descontado del fee |
| Crank | Híbrido | Backend cron + callable por cualquiera (resiliencia) |
| Fee del protocolo | En `payout` | Más visible para el user |
| Guardadito USDC | Adapter híbrido | `mock` default para demo; `kamino` detrás de env/flag |

## Postgres tables (materializadas por indexer + escritas por apps/api)

~18 tablas. Las **on-chain mirrors** reflejan estado en Comadre.sol (Monad); las **off-chain only** son la verdad para su dominio. Las tablas Monad AA (`smart_wallets`, `session_keys`, `auth_sessions`, `elevated_intents`) son nuevas en Phase 1.

| Tabla | Tipo | Qué guarda |
|---|---|---|
| `users` | mirror UserProfile | wallet (lowercase hex `0x...`), phone_hash (sha256 hex), country_code, kyc_tier, reputation_score, tandas_completed/defaulted/created, created_at |
| `smart_wallets` | identidad Monad | user_wallet, privy_user_id, owner_address (EOA Privy), smart_wallet_address (Kernel v3.1), agent_wallet_address (Turnkey), chain_id |
| `session_keys` | custodia Turnkey | smart_wallet_id, kind (`daily`/`elevated`), session_address, turnkey_sub_org_id, turnkey_wallet_id, serialized_permission, per_call_cap_micro_usdc, allowed_contracts (jsonb), allowed_recipients (jsonb), valid_until, status |
| `auth_sessions` | onboarding magic link | phone_hash, magic_token (15min TTL), privy_user_id, owner_address, status, expires_at |
| `elevated_intents` | OTP escalation | smart_wallet_id, action_payload (jsonb), twilio_verify_sid, status (`pending`/`approved`/`expired`/`consumed`), expires_at |
| `tandas` | mirror Tanda | id (tandaKey hex), creator_wallet, name, vault address, member_target/current, contribution_amount, stake_amount, frequency_seconds, total_turns/current_turn, state, payout_order_mode, next_payout_ts, started_at |
| `members` | mirror Member | id (memberKey), tanda_id, user_wallet, turn_number, contributions_made, stake_locked, is_active, has_received_payout |
| `disputes` | mirror Dispute | id (disputeKey), tanda_id, opener_wallet, reason_hash, deadline_ts, votes_continue/cancel, state |
| `dispute_votes` | mirror | dispute_id, voter_wallet, continue_tanda, voted_at |
| `conversations` | off-chain only | user_wallet, phone_hash, channel, messages (jsonb), state (jsonb) |
| `idempotency_keys` | off-chain only | key (pk), user_wallet, endpoint, status_code, response_body (jsonb), expires_at (24h TTL) |
| `ramps` | off-chain only | user_wallet, direction, provider, fiat_currency, fiat_amount_cents, usdc_amount, status, provider_ref |
| `kyc_sessions` | off-chain only | user_wallet, applicant_id (Sumsub), level_name, status, review_answer |
| **`transfers`** | **off-chain ledger** | id, sender_wallet, sender_phone_hash, recipient_phone_hash, recipient_wallet, amount_micro_usdc, note, status, tx_hash (Monad UserOp), failure_reason, expires_at |
| `contact_routes` | off-chain only | Ruta WhatsApp cifrada con `phone_ciphertext` (AES-256-GCM, `CONTACT_ENCRYPTION_KEY`) |
| `savings_positions/actions/nudges` | off-chain | Guardadito (Phase 2 — pendiente de wireado contra contratos Monad) |

**On-chain (Solidity Comadre.sol) es la verdad para tandas/disputes.** Estado autoritative reconstructible vía events en Monadscan.

## Costos estimados

Costos en MON (Monad testnet gas; precios mainnet pendientes del launch). Cada UserOp ERC-4337 consume gas equivalente a una tx EOA + overhead del bundler.

Si se activa Pimlico paymaster (Phase 2), el usuario paga $0 en gas — el paymaster sponsorea con MON propio.

---

## Custodia de claves — Turnkey

A partir de Phase 1, **no hay más `user_keypairs` con secret keys en plaintext**. La custodia se delega a Turnkey HSM:

```sql
-- session_keys table (post Phase 1)
CREATE TABLE session_keys (
  id                          UUID PRIMARY KEY,
  smart_wallet_id             UUID REFERENCES smart_wallets(id),
  kind                        session_key_kind,  -- 'daily' | 'elevated'
  session_address             TEXT NOT NULL,     -- 0x... agent wallet address
  turnkey_sub_org_id          TEXT NOT NULL,     -- sub-org en Turnkey (1 per user)
  turnkey_wallet_id           TEXT NOT NULL,     -- wallet en Turnkey
  serialized_permission       TEXT NOT NULL,     -- blob ZeroDev Kernel permission
  permission_id               TEXT NOT NULL DEFAULT '',  -- COM-033: para revoke
  per_call_cap_micro_usdc     BIGINT NOT NULL,
  allowed_contracts           JSONB NOT NULL,
  allowed_recipients          JSONB NOT NULL,
  valid_until                 TIMESTAMPTZ NOT NULL,
  status                      session_key_status NOT NULL DEFAULT 'active',
  ...
);
```

### Modelo de seguridad

- **Private key NUNCA está en el backend ni en la DB** — vive en AWS Nitro Enclaves bajo control de Turnkey
- **Backend pide firmas por referencia**: `turnkey.signEvmPayload({ subOrgId, walletId, payload })` → firma
- **Aislamiento por usuario**: sub-org Turnkey separada → un compromiso afecta a 1 usuario, no a todos
- **Defense in depth**: cap on-chain (Kernel session permission) + cap off-chain (en `signMonadTransfer`) + policies opcionales en Turnkey

### `savings_nudges`

Usada por el nudge gate (`apps/agent/src/lib/nudgeGate.ts`) para enforzar cooldown de 24h en sugerencias proactivas de Guardadito.

```sql
-- ya existía: schema con (id uuid, user_wallet, source, source_ref, amount_micro_usdc, status, message, created_at)
```

Una fila se inserta tras entregar una sugerencia. Antes de inyectar el contexto de Guardadito al LLM, el gate consulta esta tabla para verificar que no hay nudge en las últimas 24h.
