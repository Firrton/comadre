# Data Model

## On-chain (Anchor accounts)

| Account | Seeds | Tamaño | Descripción |
|---|---|---|---|
| `UserProfile` | `[b"user", wallet]` | ~96 B | Perfil del usuario, KYC tier, reputation denormalizada |
| `Tanda` | `[b"tanda", creator, tanda_id]` | ~204 B | La tanda en sí. Vault es ATA del PDA. |
| `Member` | `[b"member", tanda, user]` | ~101 B | Relación user↔tanda, turn_number, contributions |
| `Dispute` | `[b"dispute", tanda, dispute_id]` | ~125 B | Disputa abierta sobre una tanda |
| `DisputeVote` | `[b"vote", dispute, voter]` | ~82 B | Voto único por user (PDA-enforced) |
| `Loan` | `[b"loan", borrower, loan_id]` | ~117 B | Préstamo con colateral social |
| `LoanCosigner` | `[b"cosigner", loan, cosigner]` | ~90 B | Co-signer de un préstamo |
| `ReputationBadge` | `[b"badge", user, badge_id]` | ~98 B | SBT-like, no transferable |
| `ProgramConfig` | `[b"config"]` | ~205 B | Singleton admin config |

## Enums

```rust
pub enum TandaState { Forming, Active, Paused, Completed, Cancelled }
pub enum KycTier { T0Demo, T1Lite, T2Standard, T3Pro }
pub enum DisputeState { Open, Resolved, Expired }
pub enum LoanState { Pending, Active, Repaid, Defaulted }
pub enum BadgeType { TandaCompleted, TandaCreatedAndCompleted, LoanRepaidOnTime, DisputeResolvedFairly }
pub enum PayoutOrder { JoinOrder, CreatorSet, Random }
```

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

13 tablas en total. Las **on-chain mirrors** se reconstruyen del indexer (slot 0); las **off-chain only** son la verdad para su dominio.

| Tabla | Tipo | Qué guarda |
|---|---|---|
| `users` | mirror UserProfile | wallet, phone_hash (sha256 hex), country_code, kyc_tier, reputation_score, tandas_completed/defaulted/created, loans_repaid/defaulted, created_at |
| `tandas` | mirror Tanda | pda, creator_wallet, tanda_id (u64), name_hash, name (denorm), usdc_mint, vault, member_target/current, contribution_amount, stake_amount, frequency_seconds, total_turns/current_turn, state (pgEnum), payout_order_mode, next_payout_ts, started_at, last_synced_at |
| `members` | mirror Member | pda, tanda_id, user_wallet, turn_number, contributions_made, last_contribution_ts, stake_locked, is_active, has_received_payout, joined_at |
| `disputes` | mirror Dispute | pda, tanda_id, dispute_id (u8), opener_wallet, reason_hash, reason_text (denorm off-chain), opened_at, deadline_ts, votes_continue/cancel, state (`open`/`resolved_continue`/`resolved_cancel`/`expired`) |
| `dispute_votes` | mirror DisputeVote | pda, dispute_id, voter_wallet, continue_tanda (bool), voted_at |
| `loans` | mirror Loan (parcial) | pda, loan_id (u64), borrower_wallet, tanda_backing, principal, apr_bps, total_repaid, disbursed_at, due_ts, cosigner_count/signed, state (`pending`/`active`/`repaid`/`defaulted`) |
| `loan_cosigners` | mirror LoanCosigner | pda, loan_id, cosigner_wallet, stake_locked, has_signed, signed_at |
| `badges` | mirror ReputationBadge | pda, badge_id (u64), user_wallet, badge_type, source_account, value, earned_at |
| `conversations` | off-chain only | user_wallet (nullable until verified), phone_hash, channel (`whatsapp`/`web`), messages (jsonb), state (jsonb), updated_at |
| `idempotency_keys` | off-chain only | key (pk), user_wallet, endpoint, status_code, response_body (jsonb), expires_at (24h TTL, cleanup cron) |
| `ramps` | off-chain only | user_wallet, direction (`onramp`/`offramp`), provider, fiat_currency, fiat_amount_cents, usdc_amount, status (`pending`/`quoted`/`confirmed`/`completed`/`failed`), provider_ref |
| `kyc_sessions` | off-chain only | user_wallet, applicant_id (Sumsub), level_name, status (`init`/`pending`/`approved`/`rejected`/`on_hold`), review_answer (GREEN/RED) |
| **`transfers`** | **off-chain ledger** | **id (uuid pk), sender_wallet (FK users), sender_phone_hash, recipient_phone_hash, recipient_wallet (nullable for awaiting_recipient), amount_micro_usdc (u64), note, status (`pending`/`awaiting_recipient`/`confirmed`/`expired`/`cancelled`/`failed`), tx_signature, failure_reason, created_at, confirmed_at, expires_at (5min pending / 7d awaiting). Source-of-truth para P2P USDC transfers — no hay event Anchor (es SPL Token Transfer estándar)** |
| `contact_routes` | off-chain only | Ruta WhatsApp cifrada por usuario (`phone_ciphertext`) para avisos proactivos sin guardar teléfono plano |
| `savings_positions` | off-chain strategy ledger | Posición Guardadito por provider/strategy (`mock` o `kamino`), monto depositado, shares y valor conocido |
| `savings_actions` | off-chain action ledger | Acciones pendientes/confirmadas de guardar o retirar USDC; para `mock` confirma contablemente, para `kamino` referencia tx |
| `savings_nudges` | off-chain notification ledger | Dedupe de sugerencias Guardadito originadas por transferencias internas o Helius USDC incoming |

**On-chain (Anchor) es la verdad para tandas/loans/disputes/badges.** Si Postgres se corrompe, reindexamos desde slot 0 (excepto las tablas off-chain only como `conversations`, `transfers` y `savings_*`, que son ledgers operacionales).

## Costos estimados (mainnet)

Tanda de 10 miembros lifecycle completo:
- Tanda + Vault ATA: ~0.0035 SOL
- 10x Member: ~0.015 SOL
- 1x Dispute (si aplica): ~0.0019 SOL
- 10x ReputationBadge: ~0.014 SOL
- ~50 tx fees: ~0.0001 SOL
- **Total: ~0.034 SOL ≈ $5 USD**

Con fee 0.5% sobre $5,000 USD de tanda total = $25 fee → margen 80%.
