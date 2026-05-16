# Architecture Audit — 2026-05-14

## Executive summary

The codebase is in an active Solana → Monad migration. The Monad path (wallet-infra, session keys, ERC-4337) is architecturally sound and aligns closely with the WALLET_SECURITY.md design. The critical problems are: (1) **plaintext secret keys still live in the DB** via `user_keypairs`/`userSigner.ts` and remain callable at runtime; (2) **two parallel onboarding and signing paths coexist with no mutual-exclusion guard**, letting the LLM call either and potentially creating dangling plaintext-key rows for Monad users; and (3) **`monadSessionSigner.ts` calls KMS twice per transfer** — once manually and once inside `signAndSendUserOp` — voiding the first result. Secondary issues include a missing `permissionId` extraction, in-memory session key storage that doesn't survive restarts, unverified Privy JWT in the finalize step, and two verbatim-duplicated `phoneNormalize.ts` files.

---

## Findings

### CRITICAL

**C1 — Plaintext secret keys remain active and reachable at runtime**
- Refs: `apps/api/src/lib/onboarding.ts:50-52`, `apps/api/src/lib/userSigner.ts`, `packages/db/src/schema.ts:222-228`
- Why it matters: `onboardPhone()` inserts `secretKeyB58` (plain base58 Solana private key) into `user_keypairs`. `signWithUserKeypair()` reads it back and signs live transactions. WALLET_SECURITY.md §3 explicitly marks this "must die before any production launch". Any DB read access (T3 in the threat model) fully compromises every Solana-path user's funds.
- Recommended fix: Gate `onboardPhone()` behind `SOLANA_ONBOARDING_ENABLED=false` env flag and throw if called in production. Add a runtime guard in `signWithUserKeypair()` that refuses outside `NODE_ENV=development`.

**C2 — Double KMS decrypt per Monad transfer**
- Refs: `apps/api/src/lib/monadSessionSigner.ts:61-77`
- Why it matters: `signMonadTransfer()` calls `kms.decryptSessionKey()` at line 61, then immediately calls `sessionKeyApi.signAndSendUserOp()` at line 68 with the same envelope — which calls `decryptSessionKey()` again inside `sign.ts`. The first plaintext result is then `void`-ed at line 86. Every transfer pays KMS latency and billing cost twice; CloudTrail volume is doubled, making anomaly detection noisier.
- Recommended fix: Remove the standalone `kms.decryptSessionKey()` call at line 61. `signAndSendUserOp` handles it internally.

**C3 — Session private key stored in process memory with no restart durability**
- Refs: `apps/api/src/routes/onboarding.ts:138-157`, `sessionPkMemory` Map
- Why it matters: The unencrypted session private key lives in a process-scoped `Map` between `/monad/finalize` and `/monad/install-session-key`. A process restart or crash in that 5-minute window leaves the `authSession` row stuck in `pending` with no recoverable session key. In a multi-instance deployment, both calls must hit the same process instance — not guaranteed behind any load balancer.
- Recommended fix: Encrypt the session private key immediately after generation (using KMS or a short-TTL Redis entry with a hard TTL), persist it against the `authSession.id`, retrieve and delete it on `install-session-key`.

---

### HIGH

**H1 — `/monad/finalize` trusts magic token without verifying Privy JWT ownership**
- Refs: `apps/api/src/routes/onboarding.ts:269`, comment: `// V1: trust the token; phoneJwt verification deferred`
- Why it matters: The finalize endpoint accepts `privyUserId` and `ownerAddress` from the request body with no proof the caller actually authenticated via Privy. Anyone who intercepts the SMS magic link can claim an arbitrary Privy user ID and EVM address — decoupling phone verification from wallet binding.
- Recommended fix: Verify `phoneJwt` via `privy.verifyAuthToken()` and confirm the linked phone in that token matches the `phoneHash` in the `authSession` row before accepting `privyUserId`. Promote from TODO to required.

**H2 — Two onboarding tools (`iniciar_onboarding` + `iniciar_cuenta_segura`) coexist in ALL_TOOLS**
- Refs: `packages/agent-tools/src/tools.ts:608-683`, `packages/agent-tools/src/index.ts`
- Why it matters: Both tools exist in `ALL_TOOLS` and `TOOL_EXECUTORS`. The LLM can call either. `iniciar_onboarding` creates a plaintext-key `user_keypairs` row. `iniciar_cuenta_segura` starts the Monad flow. No server-side guard prevents an existing Monad user from being re-onboarded via the Solana path.
- Recommended fix: Remove `iniciar_onboarding` from `ALL_TOOLS` and `TOOL_EXECUTORS`. Add it to a permanent exclusion list (not the wallet-state filter). Return `410 Gone` from `POST /api/v1/onboarding/init` when `SOLANA_ONBOARDING_ENABLED` is false.

**H3 — `permissionId` is persisted as empty string**
- Refs: `apps/api/src/routes/onboarding.ts:370`, `// TODO(monad-onboarding): extract on-chain permissionId`
- Why it matters: `permissionId` is required for on-chain session key revocation via `uninstallValidator(permissionId)`. Without it, soft-delete (removing the DB row) is the only revocation mechanism. The on-chain validator plugin remains permanently installed for all users onboarded today.
- Recommended fix: Extract `permissionId` from the serialized blob at install time, or return it from `approveSessionKey`. Store the real value.

**H4 — `contactCrypto.ts` uses a static app-level key, not envelope encryption**
- Refs: `apps/api/src/lib/savings/contactCrypto.ts:9-16`
- Why it matters: Phone E.164 numbers in `contact_routes.phone_ciphertext` are encrypted with a key derived from `env.CONTACT_ENCRYPTION_KEY` — a static env var. Unlike session keys (KMS envelope), this key lives on the app server. A T2 threat (host compromise) exposes all contact phone numbers in cleartext.
- Recommended fix: Route `CONTACT_ENCRYPTION_KEY` through KMS, or explicitly document the accepted tradeoff in the threat model.

---

### MEDIUM

**M1 — `wallet-infra/otp/index.ts` reads env vars directly, bypassing `walletInfraEnvSchema`**
- Refs: `packages/wallet-infra/src/otp/index.ts:7-13`
- Why it matters: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` are in the schema but read via raw `process.env`. Missing vars fail silently until OTP is first called in production.
- Recommended fix: Call `loadWalletInfraEnv()` inside `getClient()` and destructure from the validated object, consistent with `kms/client.ts`.

**M2 — `phoneNormalize.ts` duplicated verbatim in `apps/api/src/lib/` and `apps/agent/src/lib/`**
- Refs: Both files are identical 13-line functions
- Why it matters: Any edge-case fix must be applied in two places; one will drift.
- Recommended fix: Move to `packages/agent-tools/src/phoneNormalize.ts` or a minimal shared package. Both consumers already depend on `@comadre/agent-tools` or `@comadre/cache`.

**M3 — Route handler in `onboarding.ts` imports `wallet-infra` directly, bypassing the lib layer**
- Refs: `apps/api/src/routes/onboarding.ts:21` — `import { sessionKey as walletSessionKey, kms as walletKms } from "@comadre/wallet-infra"`
- Why it matters: Routes should call `lib/` functions; `lib/` functions call packages. The pattern is established by `monadSessionSigner.ts` but the onboarding route bypasses it.
- Recommended fix: Extract `walletSessionKey.generateSessionKey()` and `walletKms.encryptSessionKey()` calls into a `lib/monadOnboarding.ts` file.

**M4 — `transfersMonad.ts` has a duplicate `eq` import at the bottom of the file**
- Refs: `apps/api/src/routes/transfersMonad.ts:183` — `import { eq as eqRaw } from "drizzle-orm"`
- Why it matters: `eq` is already imported at line 14. The duplicate import at the end is redundant and indicates the file was assembled without cleanup.
- Recommended fix: Remove the bottom import; use the top-level `eq` throughout.

**M5 — `savingsNudges.status` is untyped `text`, inconsistent with all other lifecycle columns**
- Refs: `packages/db/src/schema.ts:695`
- Why it matters: Every other status column uses a `pgEnum`. This one accepts any string, enforced only by application code.
- Recommended fix: Define `savingsNudgeStatusEnum` and use it. Generate a migration.

**M6 — `agent-tools/tools.ts` reads `process.env["USDC_MINT"]` directly with hardcoded devnet fallback**
- Refs: `packages/agent-tools/src/tools.ts:160`
- Why it matters: Breaks the config validation contract; puts chain-specific infra knowledge in the agent tools layer.
- Recommended fix: Move USDC mint resolution to the API's `crear_tanda` route, or add `USDC_MINT` to `@comadre/config` schema and use `env.USDC_MINT`.

---

### LOW

**L1 — `approveSessionKey` is browser-only code living in a server-side package**
- Refs: `packages/wallet-infra/src/sessionKey/approve.ts`
- Why it matters: File's own comment says it "runs in the user's browser." It expects a Privy EIP-1193 provider. `wallet-infra` is imported by `apps/api`. Conceptual boundary violation.
- Recommended fix: Move to `apps/web/lib/sessionKey/approve.ts`. Export only types from `wallet-infra` if sharing is needed.

**L2 — `stubs.ts` (`makeTxStub`) still referenced in production route handlers**
- Refs: `apps/api/src/lib/stubs.ts`
- Why it matters: Returns a zero-byte inert transaction. Routes that call it return silently non-executable transactions to users.
- Recommended fix: Replace with real instruction builders or explicit `501 Not Implemented` responses. Remove `stubs.ts`.

**L3 — Five Solana-path lib files are dead code on the active Monad path**
- Refs: `anchorBootstrap.ts`, `buildJoinTandaIx.ts`, `buildTandaIx.ts`, `privySigner.ts`, `usdcTransfer.ts` in `apps/api/src/lib/`
- Why it matters: Add cognitive overhead and maintenance surface. `anchorBootstrap.ts` is still called by `onboardPhone()`, keeping the Solana chain dependency alive.
- Recommended fix: Add `@deprecated` comment headers now. Delete after C1 is resolved.

**L4 — `ARCHITECTURE.md` describes Solana; `WALLET_SECURITY.md` describes Monad — both marked as current**
- Refs: `docs/ARCHITECTURE.md`, `docs/WALLET_SECURITY.md`
- Why it matters: A new contributor reading ARCHITECTURE.md gets an entirely wrong picture of the active system.
- Recommended fix: Add a deprecation banner to ARCHITECTURE.md pointing to WALLET_SECURITY.md. Update the topology diagram.

**L5 — Monad transfer critical path (`monadSessionSigner.ts`, `monadPhoneLookup.ts`, `monadUsdcTransfer.ts`) has zero test coverage**
- Refs: `apps/api/src/lib/monad*.ts`, `apps/api/src/__tests__/` (no corresponding files)
- Why it matters: The transfer flow — cap enforcement, KMS path, UserOp submission — is entirely untested beyond manual runs.
- Recommended fix: Unit tests for `monadUsdcTransfer.ts` edge cases; mock-based tests for `monadSessionSigner.ts` policy checks; at least one integration test for `transfersMonad.ts`.

---

## Recommended next steps

1. **Fix C2** (double KMS decrypt) — one-line removal in `monadSessionSigner.ts`, zero risk.
2. **Gate C1** (plaintext keys) behind `SOLANA_ONBOARDING_ENABLED` feature flag.
3. **Fix H2** (tool registry) — remove `iniciar_onboarding` from `ALL_TOOLS`.
4. **Fix C3** (in-memory session key) — Redis or KMS-encrypted persistence before scaling.
5. **Fix H1** (phoneJwt verification) — required before production security readiness.
6. **Fix H3** (permissionId) — required before revocation feature works at all.
7. One cleanup PR for **M1, M2, M6**.
8. Remove **L3 dead Solana files** after steps 1-2 are verified in staging.

**Open questions**:

- Does the Monad testnet RPC support `eth_estimateUserOperationGas` from Pimlico? If not, `signAndSendUserOp` fails before any E2E test runs.
- `transfersMonad.ts` inserts `sender.smartWalletAddress` as `transfers.senderWallet`, which is a FK to `users.wallet`. But when a Monad user is created in `install-session-key`, `users.wallet` is set to `normalizedOwner` (the EOA address), not the Kernel smart wallet address. Verify this FK constraint doesn't fail at runtime — the `lookupMonadByPhone` result returns `smartWalletAddress` from the `smart_wallets` table, not from `users.wallet`, so the FK target (`users.wallet = ownerAddress`) and the insert value (`senderWallet = smartWalletAddress`) are different addresses. This is likely a bug.
