# @comadre/anchor-program

El smart contract de Comadre. Rust + Anchor 0.31.

## Build & test

```bash
anchor build
anchor test                          # localnet con USDC mint clonado
anchor deploy --provider.cluster devnet
```

## Programs

- `comadre` — único programa. Maneja UserProfile, Tanda, Member, Dispute, Loan, Badge, Config.

## State accounts

| Cuenta | Seeds | Tamaño |
|---|---|---|
| `UserProfile` | `[b"user", wallet]` | ~96 bytes |
| `Tanda` | `[b"tanda", creator, tanda_id]` | ~204 bytes |
| `Member` | `[b"member", tanda, user]` | ~101 bytes |
| `Dispute` | `[b"dispute", tanda, dispute_id]` | ~125 bytes |
| `DisputeVote` | `[b"vote", dispute, voter]` | ~82 bytes |
| `Loan` | `[b"loan", borrower, loan_id]` | ~117 bytes |
| `LoanCosigner` | `[b"cosigner", loan, cosigner]` | ~90 bytes |
| `ReputationBadge` | `[b"badge", user, badge_id]` | ~98 bytes |
| `ProgramConfig` | `[b"config"]` (singleton) | ~205 bytes |

Ver [docs/DATA_MODEL.md](../../docs/DATA_MODEL.md) para detalles.
