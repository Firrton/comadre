# Spec — Excisión de tandas + identidad UUID (baseline reset)

> Fecha: 2026-06-05 · Estado: aprobado por el owner, pendiente de plan de implementación.
> Backend: Drizzle ORM + postgres-js + drizzle-kit. DB en Monad **testnet, descartable** (sin datos a preservar).

## 1. Motivación

El schema arrastra dos problemas de la visión vieja (Solana/tandas):

1. **Tablas de tanda muertas** — 7 tablas + 5 enums + 6 columnas en `users` que espejan accounts on-chain de Solana/Anchor. No sirven para las tandas futuras (que serán EVM/Monad, con otra forma). Son peso muerto con forma equivocada.
2. **Crisis de identidad del usuario** — `users.wallet` (la PK) está documentada como "Base58 Solana pubkey" pero el código de onboarding guarda ahí la **dirección owner de Privy (EVM)**. La PK confunde la identidad del cliente con una de sus tres llaves (owner / smart account / agent). La "wallet del cliente" (el smart account, donde está la plata) vive en una tabla secundaria.

Además, el **historial de migraciones está roto**: el journal referencia `0001_harsh_earthquake` cuyo `.sql` no existe, y `0004_neverland` está backdateado. Aplicar las migraciones desde cero falla.

## 2. Objetivos / No-objetivos

**Objetivos**
- Borrar todo el schema de tanda/crédito (tablas, enums, columnas).
- Rediseñar la identidad: el cliente se identifica por su WhatsApp (`phone_hash`), no por una llave.
- Dejar `smart_wallets.smart_wallet_address` como la wallet canónica del cliente.
- Resetear el baseline de migraciones a un único `0000_init` sano.
- Mantener typecheck/build verdes; actualizar tests.

**No-objetivos (diferido)**
- Implementar tandas en Monad (vuelve después, con schema EVM propio).
- KYC (código queda dormido; la columna `users.kyc_tier` se conserva).
- On/off ramps como feature (la tabla `ramps` se conserva pero no se trabaja).
- Scrubbing del historial de git de secretos (operación aparte).

## 3. Schema objetivo

### 3.1 `users` (identidad limpia)
```
users
├── id           uuid       PK default random
├── phone_hash   text       NOT NULL  UNIQUE   ← identidad humana (WhatsApp)
├── country_code varchar(2) NULL
├── kyc_tier     kyc_tier   NOT NULL default 't0_demo'
├── created_at   timestamptz NOT NULL
└── updated_at   timestamptz NOT NULL default now()
```
Se eliminan de `users`: `wallet` (PK vieja), `reputation_score`, `tandas_completed`, `tandas_defaulted`, `tandas_created`, `loans_repaid`, `loans_defaulted`.

### 3.2 Mapa de FKs (`*_wallet` text → `user_id` uuid)
| Tabla | Columna vieja | Columna nueva | onDelete |
|---|---|---|---|
| smart_wallets | user_wallet | user_id → users.id | cascade |
| conversations | user_wallet | user_id → users.id | set null |
| kyc_sessions | user_wallet | user_id → users.id | cascade |
| contact_routes | user_wallet | user_id → users.id | cascade |
| savings_positions | user_wallet | user_id → users.id | cascade |
| savings_actions | user_wallet | user_id → users.id | cascade |
| savings_nudges | user_wallet | user_id → users.id | cascade |
| ramps | user_wallet (text, sin FK) | user_id → users.id | cascade |
| idempotency_keys | user_wallet (text) | user_id → users.id | cascade |
| transfers | sender_wallet | sender_id → users.id | cascade |

Los índices únicos que referencian `user_wallet` (p.ej. `smart_wallets_user_wallet_uidx`, `savings_positions_wallet_strategy_uidx`, `contact_routes_wallet_channel_uidx`) se reescriben sobre `user_id`.

### 3.3 `transfers.recipient` (el único matiz)
El destinatario puede no ser usuario todavía. Modelo:
- `sender_id` uuid NOT NULL FK users.id
- `sender_phone_hash` text NOT NULL
- `recipient_phone_hash` text NOT NULL  ← se identifica por teléfono
- `recipient_id` uuid NULL FK users.id (set null)  ← se llena cuando el destinatario se onboarda
- `recipient_wallet` text NULL  ← dirección EVM del smart account resuelta, poblada al confirmar (destino on-chain del transfer)

### 3.4 Borrados (excisión tanda)
- **Tablas:** `tandas`, `members`, `disputes`, `dispute_votes`, `loans`, `loan_cosigners`, `badges`
- **Enums:** `tanda_state`, `payout_order`, `dispute_state`, `badge_type`, `loan_state`
- **Enum `savings_provider`:** queda `["mock","neverland"]` (el valor `kamino` simplemente no se incluye al recrear el tipo — el baseline reset evita el problema de "no se puede DROP value en Postgres").

## 4. Estrategia de migración (baseline reset)

1. Editar `packages/db/src/schema.ts` al estado objetivo (§3). Arreglar el comentario "Base58 Solana pubkey".
2. Borrar `packages/db/drizzle/migrations/*` (0000–0004 rotas + `meta/`).
3. `pnpm exec drizzle-kit generate` → genera un único `0000_init.sql` + `meta/` sano.
4. Recrear la DB de cero (drop schema / fresh DB) y aplicar (`pnpm run db:migrate` o `drizzle-kit push`).
5. `drizzle-kit generate` de nuevo debe dar **0 diffs** (schema ≡ migración).

## 5. Alcance del refactor de código

~22 referencias a `users.wallet` + usos de columnas FK. Archivos clave:
- `apps/api/src/routes/onboarding.ts` — insert `users` por `phone_hash` (obtener `id`); insert `smart_wallets` por `user_id`.
- `apps/api/src/lib/auth.ts` / resolución de wallet — resolver `user_id` por `phone_hash` o por `smart_wallets.smart_wallet_address`.
- `apps/api/src/routes/users.ts` — upsert por `phone_hash`/`id`.
- Toda query que use `users.wallet` / `userWallet` / `senderWallet` / `recipientWallet`.
- `packages/agent-tools` — cualquier tool que resuelva o use `wallet` del usuario.

**Red de seguridad:** el typecheck (`tsc --noEmit`) falla en rojo ante cualquier referencia no migrada. Es el verificador del refactor.

## 6. Plan de verificación
- `pnpm run typecheck` → 10/10.
- `pnpm run build` → 4/4.
- `bun test` → actualizar tests que insertan `wallet: OWNER` por `phone_hash`/`id`; deben pasar.
- `pnpm exec drizzle-kit generate` → 0 diffs pendientes.

## 7. Riesgos y mitigaciones
| Riesgo | Mitigación |
|---|---|
| Referencia a `users.wallet` sin migrar | typecheck la atrapa (rojo) |
| Destinatario de transfer que no es usuario | `recipient_id` nullable + `recipient_phone_hash` |
| Pérdida de datos al recrear la DB | confirmado descartable (testnet pre-lanzamiento) |
| Romper algún consumidor en `agent-tools`/`api` | grep exhaustivo + typecheck + tests antes de commitear |

## 8. Rollback
Todo se hace sobre `main` con commits por unidad de trabajo. Si algo sale mal: `git revert`/`reset` de los commits. El estado previo de la DB no importa (descartable). Las migraciones viejas quedan en el historial git por si hiciera falta consultarlas.
