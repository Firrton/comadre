# DB Excisión + Identidad UUID (A1) — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Borrar el schema de tandas/crédito y migrar la identidad del usuario a UUID de punta a punta (`users.id`), con baseline-reset de migraciones, sobre una DB de testnet descartable.

**Architecture:** La identidad deja de ser una dirección custodial y pasa a ser `users.id` (UUID). El cliente se identifica por `phone_hash` (UNIQUE). El auth resuelve `owner_address → users.id`. Las FKs pasan de `user_wallet` (text) a `user_id` (uuid). Las tablas/enums/columnas de tanda se eliminan. La wallet del cliente vive en `smart_wallets.smart_wallet_address`.

**Tech Stack:** Drizzle ORM, postgres-js, drizzle-kit, Hono (API), Kimi via agent, pnpm + bun runtime, Monad testnet.

**Estrategia de ramas:** >400 líneas → cadena de PRs (skill `chained-pr`). Cada Fase abajo es una unidad de trabajo / commit; las Fases 1–7 forman la cadena. Crear rama `feat/db-uuid-identity` desde `main` antes de empezar.

**Verde por fase:** cada fase termina con typecheck del/los paquete(s) afectado(s) en verde antes de commitear. El typecheck (`tsc --noEmit`) es la red que atrapa cualquier referencia no migrada.

---

## Mapa de archivos

**Schema (fuente de verdad):** `packages/db/src/schema.ts`, `packages/db/drizzle/migrations/*`
**Auth (linchpin A1):** `apps/api/src/middlewares/auth.ts`
**Crean usuarios:** `apps/api/src/routes/onboarding.ts`, `apps/api/src/routes/users.ts`
**Resuelve identidad (agent):** `apps/agent/src/lib/userResolver.ts`
**Threading de identidad:** `apps/agent/src/{agentLoop,index}.ts`, `apps/agent/src/lib/{nudgeGate,savingsContext}.ts`, `packages/agent-tools/src/{types,apiClient,tools,index}.ts`, `packages/wallet-infra/src/types.ts`
**Renames de queries:** `apps/api/src/routes/{savings,kyc,webhooks,transfersMonad,users,elevatedIntents}.ts`, `apps/api/src/lib/{monadPhoneLookup, savings/contactCrypto, savings/mockAdapter, savings/neverlandSavingsAdapter, savings/nudges}.ts`, `apps/cron/src/jobs/kycRefreshJob.ts`
**Se borran:** `apps/api/src/routes/{disputes,tandas}.ts`, parte tanda de `apps/cron/src/jobs/reminderJob.ts`, tests tanda
**Tests:** `apps/api/src/__tests__/{auth,elevatedIntents}.test.ts`, `packages/agent-tools/src/__tests__/tools.test.ts`

---

## Fase 1 — Schema rewrite + baseline reset

**Files:**
- Modify: `packages/db/src/schema.ts`
- Delete: `packages/db/drizzle/migrations/*` (0000–0004 + `meta/`)
- Create: `packages/db/drizzle/migrations/0000_init.sql` (vía drizzle-kit)

- [ ] **Step 1: Enums** — en `schema.ts` borrar `tandaStateEnum`, `payoutOrderEnum`, `disputeStateEnum`, `badgeTypeEnum`, `loanStateEnum`. En `savingsProviderEnum` quitar `"kamino"`:

```ts
export const savingsProviderEnum = pgEnum("savings_provider", ["mock", "neverland"]);
```

- [ ] **Step 2: Tabla `users`** — reemplazar la definición completa por:

```ts
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** SHA-256 hex del E.164 — identidad humana del cliente (WhatsApp) */
    phoneHash: text("phone_hash").notNull(),
    /** Dirección owner de Privy (EVM, lowercase 0x). Null hasta completar onboarding. Llave de lookup del auth. */
    ownerAddress: text("owner_address"),
    countryCode: varchar("country_code", { length: 2 }),
    kycTier: kycTierEnum("kyc_tier").notNull().default("t0_demo"),
    createdAt: ts("created_at").notNull(),
    updatedAt: tsNow("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("users_phone_hash_uidx").on(t.phoneHash),
    uniqueIndex("users_owner_address_uidx").on(t.ownerAddress),
    index("users_country_code_idx").on(t.countryCode),
  ]
);
```
(Quita: `wallet`, `reputationScore`, `tandasCompleted`, `tandasDefaulted`, `tandasCreated`, `loansRepaid`, `loansDefaulted`.)

- [ ] **Step 3: Borrar tablas tanda** — eliminar las definiciones `tandas`, `members`, `disputes`, `disputeVotes`, `loans`, `loanCosigners`, `badges` (secciones 2–8 del archivo).

- [ ] **Step 4: FKs `user_wallet` → `user_id`** — en cada tabla superviviente, cambiar la columna y su índice. Patrón:

```ts
// ANTES
userWallet: text("user_wallet").notNull().references(() => users.wallet, { onDelete: "cascade" }),
// DESPUÉS
userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
```
Aplicar en: `smartWallets` (cascade), `conversations` (set null, nullable), `kycSessions` (cascade), `contactRoutes` (cascade), `savingsPositions` (cascade), `savingsActions` (cascade), `savingsNudges` (cascade), `ramps` (agregar FK, cascade), `idempotencyKeys` (cambiar `userWallet text notNull` → `userId uuid notNull` FK cascade). Renombrar índices: `smart_wallets_user_wallet_uidx`→`_user_id_uidx`, `conversations_user_wallet_idx`→`_user_id_idx`, `kyc_sessions_user_wallet_idx`, `contact_routes_wallet_channel_uidx` (on `t.userId, t.channel`), `savings_positions_wallet_strategy_uidx` (on `t.userId, t.provider, t.strategyId`), `savings_positions_wallet_idx`, `savings_actions_wallet_idx`, `savings_nudges_wallet_idx`.

- [ ] **Step 5: Tabla `transfers`** — `senderWallet` → `senderId`; agregar `recipientId`; conservar `recipientWallet`/phone hashes:

```ts
senderId: uuid("sender_id").notNull().references(() => users.id, { onDelete: "cascade" }),
senderPhoneHash: text("sender_phone_hash").notNull(),
recipientPhoneHash: text("recipient_phone_hash").notNull(),
recipientId: uuid("recipient_id").references(() => users.id, { onDelete: "set null" }),
recipientWallet: text("recipient_wallet"),
```
Índice `transfers_sender_idx` → `.on(t.senderId)`.

- [ ] **Step 6: Fix comentario** — borrar/actualizar el comentario "Base58 Solana pubkey" y el bloque header que lista tablas tanda.

- [ ] **Step 7: Typecheck del paquete db**

Run: `pnpm --filter @comadre/db run typecheck`
Expected: PASS (0 errores). Si falla, hay una referencia interna al schema viejo en el propio paquete.

- [ ] **Step 8: Baseline reset de migraciones**

Run:
```bash
rm -rf packages/db/drizzle/migrations
pnpm exec --dir packages/db drizzle-kit generate
```
Expected: crea `packages/db/drizzle/migrations/0000_init.sql` + `meta/`. Inspeccionar el SQL: debe `CREATE TABLE users (id uuid ...)`, NO debe mencionar `tandas`/`members`/`disputes`/`loans`/`badges`.

- [ ] **Step 9: Verificar 0 diffs**

Run: `pnpm exec --dir packages/db drizzle-kit generate`
Expected: "No schema changes, nothing to migrate" (schema ≡ migración).

- [ ] **Step 10: Commit**

```bash
git add packages/db
git commit -m "refactor(db): UUID user identity + drop tanda schema + baseline-reset migrations"
```

---

## Fase 2 — Auth: resolución de identidad a `users.id`

**Files:**
- Modify: `apps/api/src/middlewares/auth.ts`
- Test: `apps/api/src/__tests__/auth.test.ts`

- [ ] **Step 1: Test que falla** — agregar a `auth.test.ts` un caso: en dev-bypass, `X-Dev-User-Id` se expone como `user.id`; y un request a una ruta protegida con un owner sin usuario en DB → 401.

```ts
test("dev bypass sets user.id from X-Dev-User-Id", async () => {
  const res = await app.request("/api/v1/users/me", {
    headers: { "X-Dev-User-Id": KNOWN_USER_ID, "X-Dev-Wallet": "0xowner" },
  });
  // KNOWN_USER_ID seeded in beforeAll; expect the route to resolve by id
  expect(res.status).toBe(200);
});
```

- [ ] **Step 2: Correr el test, verificar que falla**

Run: `RUN_DB_TESTS=1 bun test apps/api/src/__tests__/auth.test.ts -t "dev bypass"`
Expected: FAIL (AuthUser todavía expone `walletAddress`, no `id`).

- [ ] **Step 3: Reescribir `AuthUser` + middleware**

```ts
export type AuthUser = {
  id: string;            // users.id (UUID) — identidad canónica
  ownerAddress: string;  // dirección owner Privy (lowercase 0x)
  privyUserId: string;
  linkedAccounts: unknown[];
};
```
Dev-bypass: `X-Dev-User-Id` → `id`; `X-Dev-Wallet` → `ownerAddress`:
```ts
c.set("user" as never, {
  id: devUserId,
  ownerAddress: (devWallet ?? "").toLowerCase(),
  privyUserId: devUserId,
  linkedAccounts: [],
} satisfies AuthUser);
```
Prod: tras verificar el JWT y obtener `walletAddress` (owner), resolver a `users.id`:
```ts
import { db, users } from "@comadre/db";
import { eq } from "drizzle-orm";
const ownerAddress = (solanaAccount?.address ?? claims.userId).toLowerCase();
const rows = await db.select({ id: users.id }).from(users)
  .where(eq(users.ownerAddress, ownerAddress)).limit(1);
if (!rows[0]) return c.json({ error: "unauthorized", message: "user not provisioned" }, 401);
c.set("user" as never, {
  id: rows[0].id, ownerAddress, privyUserId: claims.userId, linkedAccounts: allAccounts,
} satisfies AuthUser);
```

- [ ] **Step 4: Correr el test, verificar que pasa**

Run: `RUN_DB_TESTS=1 bun test apps/api/src/__tests__/auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/middlewares/auth.ts apps/api/src/__tests__/auth.test.ts
git commit -m "feat(api): resolve auth identity to users.id (UUID)"
```

---

## Fase 3 — API routes + lib: `userWallet`→`userId`, `walletAddress`→`id`

**Files (modify):** `routes/onboarding.ts`, `routes/users.ts`, `routes/savings.ts`, `routes/kyc.ts`, `routes/webhooks.ts`, `routes/transfersMonad.ts`, `routes/elevatedIntents.ts`, `lib/monadPhoneLookup.ts`, `lib/savings/{contactCrypto,mockAdapter,neverlandSavingsAdapter,nudges}.ts`
**Files (delete):** `routes/disputes.ts`, `routes/tandas.ts` (+ desregistrar en `server.ts`)

- [ ] **Step 1: `onboarding.ts` (crear usuario por id)** — reemplazar el bloque de `users`/`smartWallets` (líneas ~362–395):

```ts
const existingByPhone = await tx
  .select({ id: users.id })
  .from(users)
  .where(eq(users.phoneHash, row.phoneHash))
  .limit(1);

let userId = existingByPhone[0]?.id;
if (!userId) {
  const inserted = await tx.insert(users).values({
    phoneHash: row.phoneHash,
    ownerAddress: normalizedOwner,
    kycTier: "t0_demo",
    createdAt: now,
    updatedAt: now,
  }).returning({ id: users.id });
  userId = inserted[0]!.id;
} else {
  await tx.update(users).set({ ownerAddress: normalizedOwner, updatedAt: now }).where(eq(users.id, userId));
}

const insertedSmartWallet = await tx.insert(smartWallets).values({
  userId,
  privyUserId: row.privyUserId!,
  ownerAddress: normalizedOwner,
  smartWalletAddress: normalizedSmart,
  chainId,
  agentWalletAddress: sessionAgent.agentAddress,
}).returning({ id: smartWallets.id });
```

- [ ] **Step 2: `users.ts`** — `/confirm` y `/me` por `id`. `GET /me`: `eq(users.id, user.id)`. El `/confirm` por `wallet` (línea 64, 71–90) ya no aplica con identidad por id; reescribir para devolver el perfil del `user.id` autenticado o eliminar la ruta si era legacy de squatting Solana (confirmar en review). Versión mínima de `/me`:

```ts
const rows = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
```

- [ ] **Step 3: Renames mecánicos de queries** — en cada sitio, `eq(<tabla>.userWallet, user.walletAddress)` → `eq(<tabla>.userId, user.id)` y los `.values({ userWallet: user.walletAddress })` → `.values({ userId: user.id })`. Sitios exactos:
  - `routes/kyc.ts`: 31, 58, 85
  - `routes/savings.ts`: 41 (`users.wallet`→`users.id` + `walletAddress`→`user.id`), 152, 208, 224, 234, 302, 316, 327, 384, 395, 434
  - `routes/webhooks.ts`: 114, 119, 121, 126 (`users.wallet`→`users.id`; la var `userWallet` de kycSessions → `userId`)
  - `routes/transfersMonad.ts`: 84, 87, 110, 113 (usa `senderWallet`/`recipientWallet` de la tabla → `senderId`/`recipientId` + `recipientWallet` resuelto)
  - `routes/elevatedIntents.ts`: 43 (`row.wallet.userWallet`/`user.walletAddress` → join por `smartWallets.userId`/`user.id`)
  - `lib/monadPhoneLookup.ts`: 31 (`eq(smartWallets.userWallet, users.wallet)` → `eq(smartWallets.userId, users.id)`)
  - `lib/savings/contactCrypto.ts`: 60, 73 (params + target `contactRoutes.userId`)
  - `lib/savings/mockAdapter.ts`: 13 ; `lib/savings/neverlandSavingsAdapter.ts`: 68 (`savingsPositions.userWallet` → `userId`; el parámetro `wallet`/`walletAddress` pasa a ser un `userId: string`)
  - `lib/savings/nudges.ts`: 40, 55 (param `userWallet`→`userId`)

- [ ] **Step 4: Borrar rutas tanda**

```bash
git rm apps/api/src/routes/disputes.ts apps/api/src/routes/tandas.ts
```
Quitar sus imports y `.route("/disputes", …)` / `.route("/tandas", …)` de `apps/api/src/server.ts`.

- [ ] **Step 5: Typecheck del paquete api**

Run: `pnpm --filter @comadre/api run typecheck`
Expected: PASS. Cada error rojo = un sitio `userWallet`/`walletAddress` sin migrar. Arreglar hasta 0.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "refactor(api): user_id identity across routes; drop tanda routes"
```

---

## Fase 4 — Agent: threading de `userId`

**Files:** `apps/agent/src/lib/userResolver.ts`, `apps/agent/src/agentLoop.ts`, `apps/agent/src/index.ts`, `apps/agent/src/lib/nudgeGate.ts`, `apps/agent/src/lib/savingsContext.ts`

- [ ] **Step 1: `userResolver.ts`** — resolver phone → `users.id`:

```ts
export interface ResolvedUser { userId: string; phoneE164: string; phoneHash: string; }
// ...
const rows = await db.select({ id: users.id }).from(users)
  .where(eq(users.phoneHash, phoneHash)).limit(1);
const userId = rows[0]?.id;
if (!userId) return null;
return { userId, phoneE164, phoneHash };
```

- [ ] **Step 2: `index.ts`** — `resolved?.wallet` → `resolved?.userId`; renombrar la variable local `userWallet` → `userId` (líneas 102, 105, 111–148). Lo que se pasa a tools/loop es `userId`.

- [ ] **Step 3: `agentLoop.ts`** — renombrar el campo `userWallet` → `userId` en la interfaz de input y en el pase a `ToolContext` (líneas 36, 62, 64, 95, 107, 213). `getToolsForUser(userId)`, `context: { userId: effectiveUserId ?? "" }`.

- [ ] **Step 4: `nudgeGate.ts` y `savingsContext.ts`** — param `userWallet`→`userId`; las queries usan `savingsNudges.userId` (ya migrado en schema). Sitios: nudgeGate 39,44,52,61,67,73; savingsContext 3,18.

- [ ] **Step 5: Typecheck agent**

Run: `pnpm --filter @comadre/agent run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/agent
git commit -m "refactor(agent): thread userId (UUID) instead of wallet address"
```

---

## Fase 5 — agent-tools: `context.userId` + header

**Files:** `packages/agent-tools/src/types.ts`, `apiClient.ts`, `tools.ts`, `index.ts`

- [ ] **Step 1: `types.ts`** — `ToolContext.userWallet: string` → `userId: string` (con comentario actualizado: "users.id (UUID)").

- [ ] **Step 2: `apiClient.ts`** — `ApiCallParams.userWallet` → `userId`; header dev:

```ts
if (process.env["NODE_ENV"] === "development" && params.userId) {
  headers["X-Dev-User-Id"] = params.userId;
  headers["X-Dev-Wallet"] = params.userId; // owner no requerido para identidad; placeholder no-vacío para gate dev
}
```
(Nota: el gate dev del auth exige `X-Dev-Wallet && X-Dev-User-Id`; mantener ambos no-vacíos. La identidad real es `X-Dev-User-Id`.)

- [ ] **Step 3: `tools.ts`** — reemplazar las ~25 ocurrencias `userWallet: context.userWallet` → `userId: context.userId`, y `user_wallet: context.userWallet` (línea 497) → `user_id: context.userId`. Los dos `userWallet: ""` (723, 786, onboarding tools) → `userId: ""`. `index.ts` doc-comment (15).

- [ ] **Step 4: Typecheck agent-tools**

Run: `pnpm --filter @comadre/agent-tools run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-tools
git commit -m "refactor(agent-tools): context.userId + X-Dev-User-Id header"
```

---

## Fase 6 — cron + wallet-infra

**Files:** `apps/cron/src/jobs/kycRefreshJob.ts`, `apps/cron/src/jobs/reminderJob.ts`, `packages/wallet-infra/src/types.ts`

- [ ] **Step 1: `kycRefreshJob.ts`** — `kycSessions.userWallet`→`userId` (23, 41); `users.wallet`→`users.id` donde aplique.

- [ ] **Step 2: `reminderJob.ts`** — es un job de recordatorio de TANDA (usa `members`). Borrar el job entero (la tabla `members` ya no existe) y quitar su registro del scheduler. Confirmar en review que no hay un recordatorio no-tanda que rescatar.

```bash
git rm apps/cron/src/jobs/reminderJob.ts
```
Quitar su import/registro en el scheduler de `apps/cron`.

- [ ] **Step 3: `wallet-infra/src/types.ts`** — `userWallet` (51) → `userId` si refiere a la identidad del usuario (verificar contexto; si es la dirección de wallet on-chain, dejarlo y renombrar para claridad).

- [ ] **Step 4: Typecheck cron + wallet-infra**

Run: `pnpm --filter @comadre/cron run typecheck && pnpm --filter @comadre/wallet-infra run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cron packages/wallet-infra
git commit -m "refactor(cron,wallet-infra): userId identity; drop tanda reminder job"
```

---

## Fase 7 — Tests + verificación final

**Files:** `apps/api/src/__tests__/elevatedIntents.test.ts`, `packages/agent-tools/src/__tests__/tools.test.ts`, borrar tests tanda

- [ ] **Step 1: `elevatedIntents.test.ts`** — el seed inserta `users` con `wallet: OWNER` (67) y borra por `users.wallet` (64, 98). Cambiar a `id`/`phoneHash`+`ownerAddress`; el `smartWallets` seed (75) usa `userWallet: OWNER` → `userId: <insertedId>`.

- [ ] **Step 2: `tools.test.ts`** — `ctx = { userWallet: "Bf..." }` (26, 241) → `{ userId: "<uuid>" }`; ajustar la assertion del header (75) a `X-Dev-User-Id`.

- [ ] **Step 3: Borrar tests tanda** — eliminar `apps/api/src/__tests__/tandas.test.ts` (y cualquier test de disputes) que referencie tablas borradas.

```bash
git rm apps/api/src/__tests__/tandas.test.ts
```

- [ ] **Step 4: Typecheck + build completos**

Run: `pnpm run typecheck && pnpm run build`
Expected: typecheck 10/10, build 4/4, EXIT 0.

- [ ] **Step 5: Tests**

Run: `bun test apps/agent apps/api packages/agent-tools` (los que no requieren DB) + `RUN_DB_TESTS=1 bun test apps/api` si hay DB de test disponible.
Expected: PASS (0 fail). Arreglar lo que rompa.

- [ ] **Step 6: 0 diffs de migración**

Run: `pnpm exec --dir packages/db drizzle-kit generate`
Expected: "No schema changes".

- [ ] **Step 7: Actualizar docs**

Actualizar `docs/COMADRE.md` §5 (modelo de datos): nuevo modelo de identidad (users.id, phone_hash, owner_address; wallet del cliente = smart_wallets). Quitar mención a las tablas tanda.

- [ ] **Step 8: Commit final**

```bash
git add -A
git commit -m "test(db-identity): update fixtures to UUID identity; drop tanda tests; docs"
```

---

## Self-review (cobertura del spec)

- §3.1 users nuevo → Fase 1 Step 2 ✓
- §3.2 mapa FKs → Fase 1 Step 4 ✓
- §3.3 transfers recipient → Fase 1 Step 5 ✓
- §3.4 borrados (tablas/enums/kamino) → Fase 1 Steps 1,3 ✓
- §4 baseline reset → Fase 1 Steps 8–9 ✓
- §5 A1 identidad end-to-end → Fases 2 (auth), 4 (agent), 5 (agent-tools), 6 (cron/wallet-infra) ✓
- §6 verificación → Fase 7 ✓
- §7 riesgos (typecheck como red) → cada fase termina en typecheck verde ✓
