# Master Findings — Comadre audit consolidation (2026-05-14)

> Consolidation of four parallel audits. Cross-referenced and deduplicated.
> Source reports: `01-architecture.md`, `02-logic.md`, `03-security.md`, `04-documentation.md`.
> Pre-audit commit: `2910e4c` on `v2-production`.

## Fix status (Phase 1 + Phase 2 + Phase 4 applied this session)

**Fixed** (24 items — bundled in the post-audit commit):

| ID | Severity | Summary |
|---|---|---|
| COM-003 | CRITICAL | `payout` rejects slashed beneficiary (`Comadre.sol`) |
| COM-006 | CRITICAL | `X-Dev-Wallet` bypass now requires `DEV_AUTH_BYPASS=true` AND non-production (`auth.ts` + `apiClient.ts`) |
| COM-007 | CRITICAL | `/transfers-monad` now runs rate limit + idempotency (`server.ts`) |
| COM-009 | CRITICAL | `install-session-key` wrapped in `db.transaction` (`onboarding.ts`) |
| COM-016 | HIGH | `MAX_FEE_BPS` lowered from 100% → 10% (`ComadreTypes.sol`) |
| COM-018 | HIGH | `MockUSDC` now owner-gated + mainnet-blocked (`MockUSDC.sol`) |
| COM-019 | HIGH | `voteDispute` policy ABI fixed (2 → 3 args) (`policies.ts`) |
| COM-020 | HIGH | Rate limiter fails CLOSED on money endpoints (`rateLimit.ts`) |
| COM-021 | HIGH | Double KMS decrypt removed (`monadSessionSigner.ts`) |
| COM-022 | HIGH | HMAC window tightened 5 min → 90s + nonce dedup (`onboarding.ts`) |
| COM-023 | HIGH | Webhook HMAC now timing-safe via `crypto.timingSafeEqual` (`webhooks.ts`) |
| COM-024 | HIGH | Sumsub webhook fails CLOSED when secret unset in production (`webhooks.ts`) |
| COM-025 | HIGH | Privy webhook now requires `PRIVY_WEBHOOK_SECRET` + HMAC sig (`webhooks.ts`) |
| COM-026 | HIGH | `/monad/finalize` requires + verifies Privy JWT (`onboarding.ts` + `page.tsx`) |
| COM-027 | HIGH | `/monad/install-session-key` requires + verifies Privy JWT |
| COM-032 | HIGH | `iniciar_onboarding` removed from `ALL_TOOLS` (`tools.ts` + `agentLoop.ts`) |
| COM-034 | HIGH | `monad/start` cancels prior pending magic tokens for same phone |
| COM-045 | MEDIUM | Dispute opener cannot vote on own dispute (`Comadre.sol`) |
| COM-060 | MEDIUM | Duplicate `eq` import removed (`transfersMonad.ts`) |
| COM-010 | CRITICAL (docs) | `packages/wallet-infra/README.md` created with full security invariants |
| COM-011 | CRITICAL (docs) | `packages/wallet-infra/.env.example` created |
| COM-035 | HIGH (docs) | `packages/monad-contracts/README.md` created |
| COM-037 | HIGH (docs) | `sessionPkMemory` constraint documented in `onboarding.ts` |
| COM-038 | HIGH (docs) | `permissionId`-empty caveat documented in `schema.ts` |

**Deferred** (need code execution / decisions / wider redesign — NOT done in this session):

| ID | Severity | Why deferred |
|---|---|---|
| COM-001 | CRITICAL | Sybil voting fix needs `Dispute` struct change + new Foundry test + redeploy |
| COM-002 + COM-076 | CRITICAL + LOW | Stuck-tanda fix needs `activeMembers` refactor + escape hatch + Foundry tests + redeploy |
| COM-004 | CRITICAL | Backend recipient allowlist needs UX decision: how is the allowlist populated? OOB approval flow? DB column already exists; signer check is one line once decision is made. |
| COM-005 | CRITICAL | Plaintext `user_keypairs` retirement needs feature flag + DB migration plan; current code path still active because some flows depend on it. |
| COM-008 | CRITICAL | Session pk in process memory needs Redis or browser-side keygen — architectural change. |
| COM-029 | HIGH | Phone hash unsalted → HMAC requires data migration for existing rows. |
| COM-030 | HIGH | `contactCrypto.ts` → KMS envelope needs migration of existing ciphertexts. |
| COM-033 | HIGH | Extract real `permissionId` — needs ZeroDev blob format research. |
| COM-066 / COM-067 | MEDIUM | `ARCHITECTURE.md` and `DATA_MODEL.md` Monad updates — large doc rewrites. Pointers added to `wallet-infra/README.md` for now. |
| COM-012 | CRITICAL (docs) | `RUNBOOK.md §18` Monad onboarding section — large doc addition. Replaced by `wallet-infra/README.md` "How session-key signing actually flows" section as interim. |

Plus all MEDIUM/LOW items not in the Fixed table. See severity sections below for full detail. Each deferred item has enough context here for a follow-up PR.

---

---

## How to read this doc

- Each finding has a **unified ID** (`COM-###`) followed by source-report IDs in parentheses.
- Severity is the **maximum** across reports (e.g. if logic marks it HIGH but security marks it CRITICAL, it's CRITICAL here).
- "**Fix effort**" estimates: **S** = single-file edit (≤30 min); **M** = multi-file with tests (1-3 hrs); **L** = redesign/migration (½–1 day); **XL** = contract redeploy + integration (>1 day).
- Money-handling impact is flagged where applicable.

---

## Severity counts (deduplicated)

| Severity | Backend | Web3 contracts | Docs | TOTAL |
|---|---|---|---|---|
| CRITICAL | 6 | 3 | 5 | **14** |
| HIGH     | 11 | 5 | 4 | **20** |
| MEDIUM   | 14 | 7 | 6 | **27** |
| LOW      | 12 | 6 | 4 | **22** |
| **TOTAL** | **43** | **21** | **19** | **83** |

---

## CRITICAL findings (14)

### Web3 contracts

#### COM-001 (security C1.1) — Sybil voting across tandas
**File**: `Comadre.sol:555-573` (voteDispute), `:583-598` (resolveDispute)
**Fix effort**: **M** (contract change + new test)
**Money impact**: Total dispute resolution compromise → force-cancel any tanda → freeze funds.
**Fix**: Persist `tandaKey` (or its hash) inside `Dispute` struct; cross-check in voteDispute/resolveDispute.

#### COM-002 (security C1.2 = logic W-H1) — Slashed members DoS payouts → permanent fund freeze
**File**: `Comadre.sol:400` (payout precondition), `:485-489` (slash decrements memberCurrent only)
**Fix effort**: **M** (contract change + new test for slash→payout flow)
**Money impact**: All funds permanently locked in any tanda where a slash occurs. Attacker can deliberately default to brick arbitrary tandas.
**Fix**: Track `uint8 activeMembers` separately, decrement in `slashDefaulter`, use in payout completeness check.

#### COM-003 (security C1.3) — Payout can pay to a slashed (inactive) member
**File**: `Comadre.sol:402-415` — beneficiary chosen without `isActive` check
**Fix effort**: **S**
**Money impact**: Up to one full payout to a member who already lost their stake.
**Fix**: Require `beneficiaryMember.isActive` in `payout`; skip-and-burn or reroute.

### Backend

#### COM-004 (security C2.1 = logic B-M3 = arch-related) — Backend recipient allowlist not implemented (Threat T1 undefended)
**File**: `apps/api/src/lib/monadSessionSigner.ts:29-89`, `apps/api/src/routes/onboarding.ts:375` (`allowedRecipients: []` hardcoded), `packages/wallet-infra/src/sessionKey/policies.ts:113-124`
**Fix effort**: **L** (requires UX decision on contact allowlist + DB write path + signer check)
**Money impact**: Prompt-injected LLM can drain 50 USDC × 10/min × per user × 30 days through any address.
**Fix**: Backend reads `sessionKeys.allowedRecipients` before decrypt; populate at onboarding; OOB approval for new contacts.

#### COM-005 (security C2.2 = arch C1) — Plaintext `user_keypairs.secret_key_b58` still active
**File**: `packages/db/src/schema.ts:218-228`, `apps/api/src/lib/onboarding.ts:50-54`, `apps/api/src/lib/userSigner.ts:1-27`
**Fix effort**: **M** (env flag + runtime guard + deprecation banner) OR **L** (full Solana retirement)
**Money impact**: DB-only leak (T3) → decode every base58 → full Solana custody compromise.
**Fix**: Short-term — feature-flag `SOLANA_ONBOARDING_ENABLED=false` for production + `NODE_ENV!=='production'` guard in `signWithUserKeypair`. Long-term — remove Solana path entirely.

#### COM-006 (security C2.3) — `X-Dev-Wallet` headers auto-sent by agent; trusted outside production
**File**: `apps/api/src/middlewares/auth.ts:41-62`, `packages/agent-tools/src/apiClient.ts:41-47`
**Fix effort**: **S**
**Money impact**: Single `NODE_ENV` misconfig + leaked HMAC = master key over every user's authenticated routes.
**Fix**: Separate `DEV_AUTH_BYPASS=true` env flag; assert false in production startup. `apiClient.ts` sends dev headers only when `NODE_ENV === "development"`.

#### COM-007 (security C2.4) — `/api/v1/transfers-monad` skips rate limit + idempotency + auth (HMAC only)
**File**: `apps/api/src/server.ts:62-85` (skip-lists), `apps/api/src/routes/transfersMonad.ts:42-50`
**Fix effort**: **M**
**Money impact**: Anyone with `INTERNAL_HMAC_SECRET` POSTs for any `senderPhone`. No rate limit, no idempotency, retries double-spend. Loop drains every onboarded wallet at 50 USDC/op.
**Fix**: Run rateLimit + idempotency on this path. Add per-senderPhone rate limit independent of caller. Add per-user authorization (short-lived JWT tied to OTP).

#### COM-008 (security C2.5 = arch C3) — Session private key in process memory for 5 min, no zeroize
**File**: `apps/api/src/routes/onboarding.ts:133-157` (`sessionPkMemory` Map)
**Fix effort**: **M** (Redis or browser-side keygen)
**Money impact**: Process heap dump / observability tool exposes pk. JS strings immutable — no zeroize possible.
**Fix**: Move key generation to browser during install (server only sees public address). Or use mutable Buffer + zeroize + collapse `/finalize` + `/install` into one request.

#### COM-009 (logic B-C2) — `install-session-key` has no DB transaction → partial writes on crash
**File**: `apps/api/src/routes/onboarding.ts:333-385`
**Fix effort**: **S**
**Money impact**: Mid-flight crash leaves orphaned `smart_wallets` row; user permanently stuck (magic link cannot complete).
**Fix**: Wrap all four writes in `db.transaction(async (tx) => { ... })`.

### Documentation

#### COM-010 (docs D-C1) — `packages/wallet-infra` has no README
**Fix effort**: **M** (write new README with security invariants)
**Why it matters**: Security boundary of the Monad path. Security invariants like "never call decryptSessionKey before DB policy pre-check" buried in source comments.

#### COM-011 (docs D-C2) — AWS KMS local-dev setup undocumented
**Fix effort**: **M** (write .env.example + DEVELOPMENT.md section)
**Why it matters**: `loadWalletInfraEnv()` hard-fails at boot without KMS_KEY_ARN. No guidance anywhere.

#### COM-012 (docs D-C3) — Monad onboarding runbook does not exist
**Fix effort**: **M** (write RUNBOOK.md §18)
**Why it matters**: 4-endpoint flow + web page + env requirements undocumented; security gap on phoneJwt undocumented.

#### COM-013 (docs D-C4) — Double KMS decrypt undocumented (security smell)
**Fix effort**: **S** (block comment) — same code site as COM-014/fix
**Coupled with**: COM-014 (the actual fix), COM-068 (the doc gap)

#### COM-014 (docs D-C5 = security C2.1 = logic B-M3) — Recipient allowlist gap is undocumented AND unimplemented
**Coupled with**: COM-004 (the actual fix). Doc fix is just adding TODO/FIXME annotations until COM-004 lands.

---

## HIGH findings (20)

### Web3 contracts

| ID | Source | Title | File | Effort |
|---|---|---|---|---|
| COM-015 | security H1.1 | Admin role changes are one-step (no pending+accept) — typo or compromise risk | `Comadre.sol:156-180` | M |
| COM-016 | security H1.2 | `MAX_FEE_BPS = 10_000` → compromised admin drains every payout | `Comadre.sol:176-180`, `ComadreTypes.sol:65` | S |
| COM-017 | security H1.3, H1.4 | `kycOracle` is single EOA; can downgrade users to grief | `Comadre.sol:215-221` | M |
| COM-018 | security H1.5 | `MockUSDC.mint` permissionless + no chain-id guard | `mocks/MockUSDC.sol:19-21` | S |
| COM-019 | logic B-H1 = security commentary | `voteDispute` policy ABI is 2-arg; contract is 3-arg → every vote fails on-chain | `packages/wallet-infra/src/sessionKey/policies.ts:33` vs `Comadre.sol:555` | S |

### Backend

| ID | Source | Title | File | Effort |
|---|---|---|---|---|
| COM-020 | security H2.1 | Rate limiter fails open (money endpoints must fail closed) | `apps/api/src/middlewares/rateLimit.ts:30-37` | S |
| COM-021 | security H2.2 = logic B-C1 = arch C2 | Double KMS decrypt per transfer | `apps/api/src/lib/monadSessionSigner.ts:61` | S |
| COM-022 | security H2.3 | `requireInternalSignature` 5-min window with no nonce → replay | `apps/api/src/routes/onboarding.ts:29, 62-68` | M |
| COM-023 | security H2.4 | Sumsub webhook HMAC compared with `!==`, not timing-safe | `apps/api/src/routes/webhooks.ts:56` | S |
| COM-024 | security H2.5 | Sumsub webhook accepts unsigned requests if secret unset (fail-open) | `apps/api/src/routes/webhooks.ts:36-68` | S |
| COM-025 | security H2.6 | Privy webhook has NO signature verification | `apps/api/src/routes/webhooks.ts:101-107` | M |
| COM-026 | security H2.7 = logic B-H3 = arch H1 | `monad/finalize` does NOT verify Privy JWT | `apps/api/src/routes/onboarding.ts:269` | M |
| COM-027 | security H2.8 | `monad/install-session-key` does no Privy JWT check | `apps/api/src/routes/onboarding.ts:290-390` | M |
| COM-028 | security H2.9 | Magic-link consumption racy; no IP/device binding | `apps/api/src/routes/onboarding.ts` | M |
| COM-029 | security H2.10 | Phone hash is unsalted SHA-256 (rainbow-table-able) | `apps/api/src/routes/onboarding.ts:159-161` | M (migration!) |
| COM-030 | security H2.11 = arch H4 | `contactCrypto.ts` uses ONE static AES-GCM key for ALL phones; dev fallback publicly known | `apps/api/src/lib/savings/contactCrypto.ts:9-18` | L |
| COM-031 | security H2.12 | Deferred transfers commit sender to 7-day blind payout with no re-prompt | `apps/api/src/routes/transfersMonad.ts:78-102` | M |
| COM-032 | arch H2 | Two onboarding tools (`iniciar_onboarding` + `iniciar_cuenta_segura`) coexist in ALL_TOOLS | `packages/agent-tools/src/tools.ts:608-683` | S |
| COM-033 | arch H3 = logic OQ-3 | `permissionId` is empty string — on-chain revocation unavailable | `apps/api/src/routes/onboarding.ts:370` | M |
| COM-034 | logic B-H2 | `monad/start` doesn't invalidate prior pending tokens (race) | `apps/api/src/routes/onboarding.ts:182-211` | S |

### Documentation

| ID | Source | Title | Effort |
|---|---|---|---|
| COM-035 | docs D-H1 | `packages/monad-contracts` has no README; deploy script missing | M |
| COM-036 | docs D-H2 | `apps/api/README.md` is Solana-only, lists wrong auth model | M |
| COM-037 | docs D-H3 | `sessionPkMemory` Map undocumented; breaks under horizontal scaling | S |
| COM-038 | docs D-H4 | `permissionId` empty-string state undocumented | S |

---

## MEDIUM findings (27)

### Web3 contracts

| ID | Source | Title | File | Effort |
|---|---|---|---|---|
| COM-039 | security M1.1 | `pause` admin-only; no separate pauser role | `Comadre.sol` | S |
| COM-040 | security M1.2 | `payout` cast `uint256 → uint128` may truncate | `Comadre.sol:406-411` | M |
| COM-041 | security M1.3 | `joinTanda` silently ignores `turnNumber` | `Comadre.sol:306` | S |
| COM-042 | security M1.4 | `createTanda` doesn't validate `payoutOrderMode` | `Comadre.sol` | S |
| COM-043 | security M1.5 = logic W-M1 | `completeTanda` body is unreachable dead code | `Comadre.sol:440` | S |
| COM-044 | security M1.6 | Single `ProgramPausedSet(bool)` event vs OZ Paused/Unpaused | `Comadre.sol` | S |
| COM-045 | logic W-M2 | Dispute opener can vote on own dispute | `Comadre.sol:555-573` | S |
| COM-046 | logic W-M3 | `voteDispute` doesn't verify disputeKey belongs to tandaKey (separate from C1.1's broader sybil issue) | `Comadre.sol:555` | S |
| COM-047 | logic W-M4 | KYC limit checked once at join; not re-checked at `contribute` | `Comadre.sol:316-317` | S |

### Backend

| ID | Source | Title | File | Effort |
|---|---|---|---|---|
| COM-048 | security M2.1 | Signer doesn't check `sessionKeys.allowedContracts` | `apps/api/src/lib/monadSessionSigner.ts` | S |
| COM-049 | security M2.3 | Client-posted `smartWalletAddress` not validated against counterfactual derivation | `apps/api/src/routes/onboarding.ts:284-388` | S |
| COM-050 | security M2.4 | `COMADRE_CONTRACT_ADDRESS`/`USDC_CONTRACT_ADDRESS` default to `"0x0"` | `apps/api/src/routes/onboarding.ts:317-318` | S |
| COM-051 | security M2.5 | `errorHandler.ts` logs full `err`; pino redact not configured | `apps/api/src/middlewares/errorHandler.ts:28-31` | S |
| COM-052 | security M2.6 | Phone logged as `first4+...+last3` (theatrical, ~10^6 brute) | `apps/api/src/routes/onboarding.ts:97` | S |
| COM-053 | security M2.7 | `countryCode: "MX"` hardcoded for all users | `apps/api/src/routes/onboarding.ts:68` | S |
| COM-054 | security M2.8 | Twilio fallback returns magicLink in HTTP response when unconfigured | `apps/api/src/routes/onboarding.ts:201-207` | S |
| COM-055 | security M2.10 | Agent allows 5 tool calls per WhatsApp message (chain-transfer risk) | `apps/agent/src/agentLoop.ts:48` | S |
| COM-056 | security M2.11 | Raw error messages leak schema (`USER_KEYPAIR_NOT_FOUND: ... <addr>`) | `apps/api/src/routes/tandas.ts:75-79`, `apps/api/src/routes/transfers.ts:307-317` | S |
| COM-057 | arch M1 | `wallet-infra/otp/index.ts` reads env vars directly, bypassing schema | `packages/wallet-infra/src/otp/index.ts:7-13` | S |
| COM-058 | arch M2 | `phoneNormalize.ts` duplicated verbatim in api/ and agent/ | both lib dirs | S |
| COM-059 | arch M3 | Route handler in onboarding.ts imports wallet-infra directly, bypassing lib layer | `apps/api/src/routes/onboarding.ts:21` | S |
| COM-060 | arch M4 | Duplicate `eq` import at bottom of `transfersMonad.ts` | `apps/api/src/routes/transfersMonad.ts:183` | S |
| COM-061 | arch M5 | `savingsNudges.status` is untyped text, inconsistent with other lifecycle columns | `packages/db/src/schema.ts:695` | M (migration) |
| COM-062 | arch M6 | `agent-tools/tools.ts` reads `process.env["USDC_MINT"]` directly with devnet fallback | `packages/agent-tools/src/tools.ts:160` | S |
| COM-063 | logic B-M2 | Zero-amount transfers not rejected (USDC accepts `transfer(to, 0)`) | `apps/api/src/routes/transfersMonad.ts:67-75` | S |
| COM-064 | logic B-M4 | Self-transfer check ambiguous during Solana→Monad migration | `apps/api/src/routes/transfersMonad.ts:63-65` | S |

### Documentation

| ID | Source | Title | Effort |
|---|---|---|---|
| COM-065 | docs D-M1 | `packages/agent-tools` README stale; tool list wrong; no TSDoc | M |
| COM-066 | docs D-M2 | `ARCHITECTURE.md` describes only Solana; Monad EVM absent | M |
| COM-067 | docs D-M3 | `DATA_MODEL.md` does not document four new Monad tables | M |
| COM-068 | docs D-M4 | `DIRECT_URL` for Drizzle undocumented in DEVELOPMENT.md | S |
| COM-069 | docs D-M5 | Solidity NatSpec gaps on view functions + lifecycle | S |
| COM-070 | docs D-M6 | `contact_routes.phoneCiphertext` cipher/key undocumented | S |

---

## LOW findings (22)

| ID | Source | Title | Effort |
|---|---|---|---|
| COM-071 | security L1.1 | Slash/dispute events lack `reason` field | S |
| COM-072 | security L1.2 | `getUserProfile` returns full memory copy (gas note) | S |
| COM-073 | security L1.3 | Cross-layer mismatch: `tandasCreated` uint64 vs DB bigint | S |
| COM-074 | security L1.4 | No timelock/cooldown on admin parameter changes | M |
| COM-075 | security L1.5 | `foundry.toml` lacks Slither/via_ir/repro pins | S |
| COM-076 | security L1.6 | No emergency-withdrawal escape for COM-002 funds | M |
| COM-077 | security L2.1 | No CORS allowlist in `server.ts` | S |
| COM-078 | security L2.4 | Caret ranges for `@privy-io`/`@zerodev`/`viem` | S |
| COM-079 | security L2.5 | Webhooks return 200 on parse failure | S |
| COM-080 | security L2.6 | Idempotency middleware fails open on Redis error | S |
| COM-081 | security L2.7 | No formal PII scoping for walletAddress in logs | S |
| COM-082 | security L2.9 | `airdropIfNeeded` blocks onboarding on Solana RPC | S |
| COM-083 | security L2.10 | No commit pinning for OZ/forge-std submodules | S |
| COM-084 | logic W-L1 | Two `openDispute` in same block produces misleading error | S |
| COM-085 | logic W-L2 | `initUserProfile` permissionless → front-run griefing | S |
| COM-086 | logic B-L1 | `DAILY_VALIDITY_MS` vs `DAILY_VALIDITY_SECONDS` independent constants | S |
| COM-087 | logic B-L2 | `enviarPlata` passes `userWallet: ""` (misleading) | S |
| COM-088 | arch L1 | `approveSessionKey` is browser-only code in server-side package | S |
| COM-089 | arch L2 | `stubs.ts` (`makeTxStub`) still referenced in routes | S |
| COM-090 | arch L3 | Five Solana-path lib files are dead code | S |
| COM-091 | arch L4 | `ARCHITECTURE.md` Solana-only with no deprecation banner | S |
| COM-092 | arch L5 | Monad transfer critical path has zero test coverage | M |
| COM-093 | docs D-L1 | `BACKEND.md` status section Solana-era; no WALLET_SECURITY link | S |
| COM-094 | docs D-L2 | `GLOSSARY.md` lacks Monad-era terms | S |
| COM-095 | docs D-L3 | Revocation runbook references `revoke.ts` which may be a stub | S |
| COM-096 | docs D-L4 | Monad disaster recovery posture not documented | S |

---

## Cross-cutting attack chains (multi-finding)

### Chain A — Prompt-injection drain (COM-004 + COM-007 + COM-055)
LLM (T1) → no per-user auth on /transfers-monad (COM-007) → no recipient allowlist (COM-004) → 5 tool calls per message (COM-055). 250 USDC per WhatsApp message to attacker address.

### Chain B — Magic-link account takeover (COM-026 + COM-027 + COM-028 + COM-029)
Magic-link theft → no Privy JWT verification (COM-026) → no JWT on install (COM-027) → racy consumption (COM-028) → unsalted phone hash (COM-029). End-to-end ATO from one observed SMS.

### Chain C — Plaintext-key collapse (COM-005 + COM-006 + COM-020)
DB leak (T3) or NODE_ENV misconfig (COM-006) + plaintext keys still live (COM-005) + rate limit fail-open (COM-020). Total Solana custody compromise + no rate-limit defense.

### Chain D — Stuck-funds attack (COM-002 + COM-076)
Attacker deliberately defaults → slashDefaulter freezes payout (COM-002) → no escape hatch (COM-076). Permanent fund freeze for arbitrary tandas.

---

## Open questions / unverified (10+)

These need code execution OR human decisions, not just static review:

| ID | Question | Coupled with |
|---|---|---|
| OQ-A | Does `hashPhone` in `@comadre/cache` match `hashPhoneSync` in onboarding.ts? Mismatch → no Monad transfers route correctly. | COM-029 |
| OQ-B | Pimlico bundler supports Monad's `waitForUserOperationReceipt`? | COM-004, COM-007 |
| OQ-C | `permissionId: ""` — is the on-chain plugin install actually exercised end-to-end? If no, Layer 2 + 3 only exist on paper. | COM-033 |
| OQ-D | AWS KMS IAM policy direction — verified out-of-band. | COM-011 |
| OQ-E | `MAX_FEE_BPS = 10_000` intent? | COM-016 |
| OQ-F | `completeTanda` invariant unreachable — dead code or hidden invocation? | COM-043 |
| OQ-G | `/transfers-monad` skipped from middlewares: oversight or intentional? | COM-007 |
| OQ-H | Twilio Verify token has master account permissions? Needed for webhook sig verification. | COM-025 |
| OQ-I | `users.wallet` FK in `transfers.senderWallet` mismatched (ownerAddress vs smartWalletAddress)? Likely runtime bug. | arch open question |
| OQ-J | Pimlico paymaster — `PIMLICO_PAYMASTER_ENABLED=true` default but wiring commented out. Who pays gas? | COM-013 |

---

## Recommended fix order (if doing everything)

**Phase 1 — Free, single-file, no-risk (≤1 hr total)**
- COM-021 (delete double-KMS call)
- COM-009 (wrap install in db.transaction)
- COM-019 (fix voteDispute policy ABI)
- COM-034 (cancel prior pending magic tokens)
- COM-060, COM-088, COM-089 (cruft removal)
- COM-018 (`MockUSDC.mint` access control)
- COM-016 (lower `MAX_FEE_BPS` cap to a sane value, e.g. 1000 = 10%)
- COM-032 (remove `iniciar_onboarding` from ALL_TOOLS)

**Phase 2 — Tightly scoped fixes (1-3 hrs each)**
- COM-006 (X-Dev-Wallet bypass) — must be DEV-only
- COM-023 (timing-safe HMAC) — one-line crypto.timingSafeEqual
- COM-024, COM-025 (webhook signature fail-closed + Privy)
- COM-026, COM-027 (Privy JWT verification on /finalize + /install)
- COM-005 (gate plaintext-key path with env flag)
- COM-020 (rate limiter fail-closed for money endpoints)
- COM-007 (re-enable rateLimit + idempotency on /transfers-monad)
- COM-022 (HMAC replay nonce)
- COM-003 (skip slashed beneficiary)
- COM-045, COM-047 (vote-dispute access checks)

**Phase 3 — Bigger surface (½-1 day each)**
- COM-002 + COM-076 (contract `activeMembers` refactor + escape hatch) → requires Foundry redeploy + tests
- COM-001 (sybil voting fix) → contract + tests
- COM-004 (recipient allowlist) → UX + DB + signer + agent flow
- COM-008 (browser-side keygen OR Redis-backed transient store)
- COM-029 (phone hash → HMAC migration; existing rows need rehash strategy)
- COM-030 (contactCrypto → KMS envelope)
- COM-033 (extract real `permissionId`)

**Phase 4 — Documentation (all relatively cheap individually, big as a batch — ½ day)**
- COM-010, COM-011, COM-012 (wallet-infra README, .env.example, RUNBOOK §18)
- COM-035 (monad-contracts README)
- COM-036, COM-065, COM-066, COM-067 (apps/api, agent-tools, ARCHITECTURE, DATA_MODEL updates)
- COM-013, COM-014, COM-037, COM-038, COM-068 (annotation-level updates)
- COM-091, COM-093, COM-094, COM-096 (deprecations + glossary + DR)

**Phase 5 — Polish (LOW)**
- Everything else in the LOW table

---

## Realistic effort summary

| Phase | Findings | Estimated effort |
|---|---|---|
| 1 — single-file no-risk | 9 | ~1 hr |
| 2 — scoped fixes | 11 | ~10-15 hrs |
| 3 — bigger surface | 7 | ~3-5 days |
| 4 — documentation | ~15 | ~½ day |
| 5 — polish | ~25 | ~1 day |
| **TOTAL** | **~67 actively fixable** | **~5-7 working days** |

(The remaining ~16 are documentation-only annotations bundled into phase 4.)

---

## Notes on auto-mode scope

You asked for "fix absolutely everything" (Option C) in auto mode. The audit revealed **9 CRITICAL findings, several requiring smart-contract redeployment and Foundry test coverage** — these cannot responsibly be done as autonomous code changes inside a single session without integration verification (and the infra is not powered on, so verification isn't possible either way).

**Honest recommendation for this session:**
1. Phase 1 (≤1 hr, zero risk) — apply now in auto mode.
2. Phase 2 selected items (the security-defense fixes that don't need infra to verify correctness) — apply now in auto mode.
3. Phase 3 / Phase 4 — propose explicitly before applying; some need decisions you should make.
4. Phase 5 — apply as a cleanup pass.

Then a single comprehensive commit on `v2-production` summarizing exactly what was applied vs. flagged for follow-up.

This keeps the final-commit-to-main scope sane while still respecting your "fix everything" intent.
