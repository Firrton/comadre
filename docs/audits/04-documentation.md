# Documentation Audit — 2026-05-14

## Executive summary

The existing documentation ecosystem is unusually strong for a pre-MVP solo project: `WALLET_SECURITY.md` is thorough, `RUNBOOK.md` covers the Solana-era end-to-end flows, and `BACKEND.md` gives new developers a navigable hub. The critical gap is that the codebase is mid-pivot (Solana → Monad EVM), and the documentation has not fully caught up. Three new packages (`wallet-infra`, `monad-contracts`) and several new route/lib files (`onboarding.ts` Monad endpoints, `transfersMonad.ts`, `monadSessionSigner.ts`) have no READMEs, no env-var documentation, and no runbooks for the operations they own. This leaves the new security-critical Monad signing path undocumented for any contributor who does not already know the full codebase — the single most important risk in this audit.

---

## Coverage matrix

| Package / area | README | Env docs | Runbook | Public API documented | NatSpec |
|---|---|---|---|---|---|
| apps/api | ⚠️ (stale — Solana-only, no Monad routes) | ⚠️ (missing: KMS, PIMLICO, MONAD_*, TWILIO_VERIFY, ONBOARDING_BASE_URL) | ⚠️ (RUNBOOK.md covers old Solana path only) | ⚠️ (new /onboarding/monad/* and /transfers-monad undocumented) | n/a |
| apps/agent | ✅ (good) | ✅ | n/a | ✅ | n/a |
| packages/agent-tools | ⚠️ (stale tool list; mentions Claude not Kimi K2) | ❌ (no env vars documented) | n/a | ❌ (no TSDoc on public exports) | n/a |
| packages/wallet-infra | ❌ (no README) | ❌ (no .env.example; env vars only in config.ts Zod schema) | ❌ (no runbook for: KMS setup, session-key test, OTP test) | ⚠️ (good JSDoc on kms/client.ts; otp/ and privy/ missing) | n/a |
| packages/db | ⚠️ (two-line README; no mention of new Monad tables) | ❌ (DIRECT_URL undocumented) | ⚠️ (commands listed, DIRECT_URL missing) | ✅ (schema.ts inline docs are good) | n/a |
| packages/monad-contracts | ❌ (no README) | ⚠️ (.env.example exists; missing deployer key note) | ❌ (no deploy runbook despite deploy:testnet npm script) | ⚠️ (contract-level @title/@notice good; view functions missing @return) | ⚠️ (most functions documented; startTanda/completeTanda/resolveDispute missing @param) |

---

## Findings

### CRITICAL — blocks new contributors or hides security intent

#### D-C1 — `packages/wallet-infra` has no README

- **Refs**: `/Users/firrton/comadre/packages/wallet-infra/` (no README.md at package root)
- **Why it matters**: This package is the entire cryptographic security boundary of the Monad path. It owns AES-256-GCM, AWS KMS envelope encryption, session-key generation, ZeroDev Kernel serialization, and OTP delivery. A new developer or AI agent working on any Monad feature will reach for this package first and find no documentation explaining: what it owns, which sub-path to call for what purpose, what env vars are required, and — critically — which functions must NEVER be called without the DB pre-check. The comment in `sign.ts` "Caller is responsible for pre-checking allowedRecipients / amount caps against the policiesJson digest in the DB row BEFORE invoking this function" is the only guard stating this invariant. Security intent buried in a source file is not a substitute for documentation.
- **Recommended doc**: Create `packages/wallet-infra/README.md` with: (1) Purpose + security invariant. (2) Sub-path map (kms/, sessionKey/, otp/, kernel/, privy/). (3) Complete env-var table (14 vars from `config.ts`). (4) "Security invariants" section: never call decryptSessionKey before DB policy pre-check; zeroize(dek) in finally; sessionPrivateKey never logged or cached. (5) Local dev note: aesGcm.test.ts runs without KMS; full KMS integration needs AWS_PROFILE with kms:GenerateDataKey + kms:Decrypt.

#### D-C2 — AWS KMS local dev setup is completely undocumented

- **Refs**: `packages/wallet-infra/src/config.ts` (KMS_KEY_ARN required, regex-validated), `docs/DEVELOPMENT.md` (no mention of KMS), `docs/RUNBOOK.md` (no mention)
- **Why it matters**: `loadWalletInfraEnv()` requires `KMS_KEY_ARN` matching a strict ARN regex at process startup. A developer who tries to run any Monad endpoint locally hits a hard boot failure with zero guidance. No `.env.example` in `packages/wallet-infra/`. DEVELOPMENT.md documents zero of the 14 wallet-infra env vars. The "git clone → working in 15 min" goal from BACKEND.md is impossible for the Monad path.
- **Recommended doc**: (1) Create `packages/wallet-infra/.env.example` with all 14 vars + comments. (2) Add "Monad / wallet-infra setup" to `DEVELOPMENT.md`: AWS KMS provisioning (`aws kms create-key --key-usage ENCRYPT_DECRYPT --key-spec SYMMETRIC_DEFAULT`), IAM permissions needed, note about aesGcm-only tests skipping KMS.

#### D-C3 — Monad onboarding runbook does not exist

- **Refs**: `docs/WALLET_SECURITY.md` §4 (design), `apps/api/src/routes/onboarding.ts` (4 new endpoints), `docs/RUNBOOK.md` §12 (Solana only), `apps/web/app/o/` (exists, no docs)
- **Why it matters**: End-to-end Monad onboarding requires ONBOARDING_BASE_URL, TWILIO_SMS_FROM, auth_sessions migration, KMS key (D-C2), Privy app on Monad EVM, web page at /o/[token]. None of this is documented. Also buried in `onboarding.ts:270`: `// V1: trust the token; phoneJwt verification deferred` — undocumented security gap.
- **Recommended doc**: Add §18 "Flujo end-to-end: Monad onboarding" to RUNBOOK.md: prerequisites checklist, 4-backend-step sequence with curl examples, web page role (`approveSessionKey` client-side), state-validation queries, "Known security gap (V1)" callout for the missing phoneJwt verification.

#### D-C4 — `monadSessionSigner.ts` triggers a redundant second KMS decrypt; the double-decrypt is undocumented

- **Refs**: `apps/api/src/lib/monadSessionSigner.ts:61-67` and line 86, `packages/wallet-infra/src/sessionKey/sign.ts`
- **Why it matters**: Every transfer incurs two KMS decrypt operations where one is needed. The dangling `plaintext` variable holding the raw session private key is in scope for the entire rest of the function body — a future developer could accidentally "use" it. The `void plaintext` suppression is not a security guarantee. Not documented as intentional or as technical debt.
- **Recommended doc**: Add `// FIXME(double-decrypt): redundant — signAndSendUserOp decrypts internally...` block comment. Add open-decisions row to `WALLET_SECURITY.md §12`.

#### D-C5 — Recipient allowlist enforcement described as backend-enforced but not implemented

- **Refs**: `docs/WALLET_SECURITY.md` §5 step 1, §10 ("backend-enforced before signing"), `apps/api/src/lib/monadSessionSigner.ts` (checks only `perCallCapMicroUsdc` and `validUntil`), `packages/db/src/schema.ts:777` (`allowedRecipients jsonb default []`)
- **Why it matters**: WALLET_SECURITY.md says the recipient allowlist is the backend's responsibility (on-chain enforcement intentionally omitted). But `signMonadTransfer` only checks the cap. `allowedRecipients` column is populated as `[]` at onboarding and never queried at transfer time. A prompt-injected or over-helpful LLM can sign a USDC transfer to ANY address ≤ 50 USDC. The architectural defense described does not match the implementation.
- **Recommended doc**: Add TODO comment in `monadSessionSigner.ts` referencing this finding. Add open-decisions row to `WALLET_SECURITY.md §12`.

---

### HIGH — significant onboarding friction

#### D-H1 — `packages/monad-contracts` has no README and the deploy script directory is empty

- **Refs**: `packages/monad-contracts/` (no README.md), `package.json` (`deploy:testnet` references `script/Deploy.s.sol` which doesn't exist), `.env.example` (incomplete)
- **Why it matters**: `deploy:testnet` will fail immediately. No docs for: deployer key via `cast wallet import`, post-deploy steps (set COMADRE_CONTRACT_ADDRESS), constructor parameters (KYC_ORACLE, CRANK_AUTHORITY, FEE_DESTINATION are zero-address placeholders), `MIN_FREQUENCY = 86_400` surprise for short-cycle testing.
- **Recommended doc**: Create `script/Deploy.s.sol` (or document as pending). Create `packages/monad-contracts/README.md` with prerequisites, full deploy sequence, testnet defaults, post-deploy steps, verification note, MIN_FREQUENCY caveat.

#### D-H2 — `apps/api` README is Solana-only and lists incorrect/stale endpoints

- **Refs**: `apps/api/README.md` (Solana stub routes; "Privy JWT" for all routes — wrong), `apps/api/src/server.ts` (10 routers; onboarding + transfers-monad use internal HMAC)
- **Why it matters**: README endpoint table doesn't include the new Monad routes; auth column is wrong; env-var table missing 8 Monad vars. Developer integrates with wrong auth header, wastes hours debugging.
- **Recommended doc**: Update endpoint table with all 10 routers and an auth-mechanism column. Add the 8 missing env vars. Note about dual Solana/Monad path.

#### D-H3 — In-memory `sessionPkMemory` Map undocumented; silently breaks under horizontal scaling

- **Refs**: `apps/api/src/routes/onboarding.ts:133-157`
- **Why it matters**: Session private key held in process memory for ≤5 min between `/monad/finalize` and `/monad/install-session-key`. Consequences a developer can't discover without reading all the code: process restart loses key; consume-once semantics; multi-instance load balancer needs sticky sessions. None of this documented.
- **Recommended doc**: Block comment above `sessionPkMemory` explaining: 5-min window, consume-once, single-instance constraint, restart behavior, cross-ref to WALLET_SECURITY.md §4.3 step 6. Add to RUNBOOK.md §18.

#### D-H4 — `permissionId` stored as empty string; on-chain revocation impossible but undocumented

- **Refs**: `apps/api/src/routes/onboarding.ts:371` (`permissionId: ""` TODO), `packages/db/src/schema.ts:766`, `docs/WALLET_SECURITY.md §7` revocation table
- **Why it matters**: WALLET_SECURITY.md §7 documents on-chain revocation via `uninstallValidator(permissionId)`. With empty string, this call can't be constructed — the on-chain revocation path described in the threat model doesn't exist. A security responder discovers this only at the moment of crisis.
- **Recommended doc**: Schema comment above `permissionId` noting current empty-string state and consequences. Add open-decisions row to WALLET_SECURITY.md §12.

---

### MEDIUM — improvements that pay off

#### D-M1 — `packages/agent-tools` README is stale; tool list wrong; no TSDoc on public exports

- **Refs**: `packages/agent-tools/README.md` (9 tools listed, "Claude Sonnet 4.6" — wrong; missing iniciar_cuenta_segura/guardar_usdc/retirar_guardadito/consultar_guardadito); `agentLoop.ts:50` (TOOLS_ALLOWED_WITHOUT_WALLET set)
- **Why it matters**: Primary contribution workflow is adding a tool. Developer reads README, finds wrong LLM name, wrong tool list, no explanation of `ToolContext`, `ToolResult`, `ToolDefinition`. `summary` field purpose unclear. `userWallet = ""` sentinel undocumented.
- **Recommended doc**: Update README: correct tool list, Kimi K2, "How to add a tool" section. TSDoc on `types.ts` for ToolContext, ToolResult, ToolDefinition.

#### D-M2 — `ARCHITECTURE.md` describes only Solana topology; Monad EVM absent

- **Refs**: `docs/ARCHITECTURE.md` (Solana devnet, Helius RPC; no Monad/Pimlico/ZeroDev/ERC-4337); auth model section stale (Privy JWT for all routes)
- **Why it matters**: New developer thinks project is Solana throughout. Gets confused discovering `/transfers-monad` and `wallet-infra`.
- **Recommended doc**: Add "Migration state (2026-05)" section: route table Solana-era vs Monad-era; updated stack table with Monad row; Monad topology diagram alongside Solana.

#### D-M3 — `DATA_MODEL.md` does not document the four new Monad tables

- **Refs**: `docs/DATA_MODEL.md` (ends at savings_nudges; no mention of smart_wallets/session_keys/auth_sessions/elevated_intents); `packages/db/src/schema.ts:719-846`
- **Why it matters**: DATA_MODEL.md is the canonical Postgres reference. Four new security-critical tables entirely absent. Developer debugging onboarding by querying DB has no reference.
- **Recommended doc**: Add "Monad Account Abstraction tables" section. Cross-ref WALLET_SECURITY.md §8.

#### D-M4 — `DIRECT_URL` for Drizzle migrations undocumented in DEVELOPMENT.md

- **Refs**: `docs/RUNBOOK.md §9` (mentioned in passing), `docs/DEVELOPMENT.md` (no mention)
- **Why it matters**: Running `bun run db:migrate` against Supabase without DIRECT_URL → "prepared statement already exists" with no clear cause. Common first-day blocker.
- **Recommended doc**: Add to DEVELOPMENT.md: Supabase Dashboard → Settings → Database → URI without pooling. Set both DATABASE_URL (pooled) and DIRECT_URL (direct, for migrations).

#### D-M5 — Solidity NatSpec gaps on view functions and three lifecycle functions

- **Refs**: `Comadre.sol:657-675` (5 view fns lack @notice/@return); startTanda:345, completeTanda:435, resolveDispute:583 (missing @param)
- **Why it matters**: View functions are the indexer/frontend interface. Without @return, ABI consumers can't surface semantics of packed struct fields (vaultBalance is micro-USDC; tandasCreated is u64; etc.).
- **Recommended doc**: Add @notice/@return to all 5 views. Annotate non-obvious fields. Add @param to startTanda/completeTanda/resolveDispute.

#### D-M6 — `contact_routes.phoneCiphertext` has no documentation on cipher algorithm or key location

- **Refs**: `packages/db/src/schema.ts:613-631` ("encrypted E.164 number" only), `apps/api/src/lib/savings/contactCrypto.ts`
- **Why it matters**: For security review or incident response: what algorithm, what key, where does it live, rotation, loss consequences? Phone numbers are PII; encryption scheme should be traceable.
- **Recommended doc**: Update `contact_routes` table comment with algorithm, key source, consequence of key loss.

---

### LOW — polish, future considerations

#### D-L1 — `BACKEND.md` "Status del proyecto" is Solana-era only; does not link WALLET_SECURITY.md

- **Refs**: `docs/BACKEND.md:168-197` (21 PRs, Sprint 1+ Solana); sub-docs nav table missing WALLET_SECURITY.md
- **Recommended doc**: Update blocking-items table with Monad-era items (KMS key, Pimlico API key, COMADRE_CONTRACT_ADDRESS, USDC on Monad testnet). Add WALLET_SECURITY.md to navigation.

#### D-L2 — `GLOSSARY.md` likely does not define Monad-era terms

- **Refs**: GLOSSARY.md not read in this audit; codebase uses UserOperation, Bundler, Paymaster, EntryPoint 0.7, Kernel v3.1, permissionId, DEK, envelope encryption, ZeroDev, magic token, session_key_kind without entries.
- **Recommended doc**: Add "Monad / Account Abstraction" section with these terms.

#### D-L3 — Revocation runbook in WALLET_SECURITY.md §7 but `sessionKey/revoke.ts` may be a stub

- **Refs**: `packages/wallet-infra/src/sessionKey/revoke.ts`, `docs/WALLET_SECURITY.md §7`
- **Recommended doc**: Read revoke.ts; update WALLET_SECURITY.md §7 to cross-ref the function (if implemented) or note "NOT YET IMPLEMENTED — pending permissionId (D-H4)".

#### D-L4 — Monad disaster recovery posture not documented; RUNBOOK.md §11 covers only Solana

- **Refs**: `docs/RUNBOOK.md §11` (user_keypairs only)
- **Recommended doc**: Add "Monad disaster recovery" subsection: DB loss → session keys gone, users re-onboard, funds safe (Privy survives); KMS loss → same; Privy loss → catastrophic (Privy own recovery); what to back up.

---

## Recommended doc structure

Files to create or substantively update, in priority order:

```
packages/wallet-infra/
  README.md                          ← CREATE (D-C1)
  .env.example                       ← CREATE (D-C2)

packages/monad-contracts/
  README.md                          ← CREATE (D-H1)
  script/Deploy.s.sol                ← CREATE or note as pending (D-H1)

docs/
  DEVELOPMENT.md                     ← UPDATE (D-C2, D-M4): Monad env vars, KMS setup, DIRECT_URL
  RUNBOOK.md                         ← UPDATE (D-C3, D-H3, D-L4): §18 Monad onboarding, in-memory window, Monad DR
  ARCHITECTURE.md                    ← UPDATE (D-M2): dual-path state, Monad topology, updated stack table
  DATA_MODEL.md                      ← UPDATE (D-M3): four new Monad tables
  WALLET_SECURITY.md                 ← UPDATE (D-C4, D-C5, D-H4): double-decrypt note, allowedRecipients gap, permissionId gap, open issues rows
  BACKEND.md                         ← UPDATE (D-L1): add WALLET_SECURITY.md to nav, update status items

apps/api/README.md                   ← UPDATE (D-H2): all 10 routers, auth per router, missing env vars

packages/agent-tools/README.md       ← UPDATE (D-M1): correct tool list, Kimi K2, how to add a tool
packages/agent-tools/src/types.ts    ← UPDATE (D-M1): TSDoc on ToolContext, ToolResult, ToolDefinition

packages/monad-contracts/src/Comadre.sol       ← UPDATE (D-M5): NatSpec on view functions + 3 lifecycle functions
packages/db/src/schema.ts                       ← UPDATE (D-H4, D-M6): permissionId caveat, phoneCiphertext cipher doc
apps/api/src/lib/monadSessionSigner.ts          ← UPDATE (D-C4, D-C5): double-decrypt FIXME, allowedRecipients TODO
apps/api/src/routes/onboarding.ts               ← UPDATE (D-H3, D-C3): in-memory window comment, phoneJwt gap comment
```
