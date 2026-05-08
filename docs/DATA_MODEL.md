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
| Yield USDC vault | Mock en MVP | Kamino integration post-hackathon |

## Postgres tables (materializadas por indexer)

```
users                    — phone_e164, wallet, privy_id, kyc_tier, reputation_score
tandas                   — pda, creator_wallet, name, member_target, state, ...
members                  — pda, tanda_id, user_wallet, turn_number, contributions_made
disputes                 — pda, tanda_id, opener_wallet, votes_continue, votes_cancel, state
dispute_votes            — pda, dispute_id, voter_wallet, vote
loans                    — pda, borrower_wallet, principal, state
loan_cosigners           — pda, loan_id, cosigner_wallet
badges                   — pda, user_wallet, type, source, value
conversations            — user_id, history (jsonb), updated_at
idempotency_keys         — user_id, key, response, expires_at
ramps                    — user_id, type (on/off), provider, status, amounts
kyc_sessions             — user_id, sumsub_session_id, status, expires_at
```

**Postgres es secundario.** Solana es la verdad. Si Postgres se corrompe, reindexamos desde slot 0.

## Costos estimados (mainnet)

Tanda de 10 miembros lifecycle completo:
- Tanda + Vault ATA: ~0.0035 SOL
- 10x Member: ~0.015 SOL
- 1x Dispute (si aplica): ~0.0019 SOL
- 10x ReputationBadge: ~0.014 SOL
- ~50 tx fees: ~0.0001 SOL
- **Total: ~0.034 SOL ≈ $5 USD**

Con fee 0.5% sobre $5,000 USD de tanda total = $25 fee → margen 80%.
