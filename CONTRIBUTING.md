# Contributing to Comadre

## Setup local

```bash
git clone https://github.com/Firrton/comadre.git
cd comadre
bun install
cp .env.example .env.local
# llenar secrets
bun run db:migrate
bun run dev
```

## Branching

- `main` — siempre deployable, deploy automático a staging.
- `feature/<name>` — work in progress.
- PR a `main` requiere review de al menos 1 dev.

## Commits

Convencional commits:
- `feat: nueva instruction de payout`
- `fix: race condition en idempotency`
- `chore: bump deps`
- `docs: update ARCHITECTURE`

## Pre-commit

- `bun run lint`
- `bun run typecheck`
- `bun run test` (afectados por turbo)

## Smart contract changes

Cambios en `packages/anchor-program/` requieren:
1. `anchor build` exitoso.
2. `anchor test` pasando 100%.
3. Codegen del client: `bun run codegen:client`.
4. Commit incluye IDL actualizado en `packages/anchor-client/src/idl/`.

## Deploy del programa

Solo el admin (multisig en mainnet, designated dev en devnet). Commit message debe incluir `[deploy-program]` para triggerar el workflow.

## Code style

- TypeScript strict mode, no `any`.
- Rust: `cargo fmt` + `clippy -- -D warnings`.
- Imports ordenados (eslint).
- Funciones < 50 líneas idealmente.
- No comentarios obvios. Sí JSDoc en funciones públicas con behavior no obvio.
