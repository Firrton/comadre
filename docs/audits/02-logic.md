# Logic Audit — 2026-05-14

> Scope: business-logic correctness only. Pre-audit commit: 2910e4c, branch v2-production.

---

## Executive summary

- **Web3 (Solidity):** 1 HIGH, 4 MEDIUM, 3 LOW. The most impactful is a stuck-tanda bug (W-H1): after any member is slashed, `payout` will forever revert with `MissingContributions` because it checks `contributionsThisTurn != memberTarget` (original count) instead of the active member count. A second serious issue (W-M1) is that `completeTanda` contains a guard that is logically impossible to pass — the function body is permanently dead code.
- **Web2 backend:** 2 CRITICAL, 3 HIGH, 4 MEDIUM, 2 LOW. Critical #1 (B-C1): `signMonadTransfer` calls `kms.decryptSessionKey` directly and then passes the same envelope to `signAndSendUserOp`, which decrypts it a second time — double KMS cost per transfer. Critical #2 (B-C2): the `install-session-key` handler executes four DB writes with no transaction wrapper — a mid-flight crash leaves orphaned rows and a permanently stuck user.
- **Cross-layer:** the ABI for `voteDispute` in the session-key policy has 2 arguments; the contract requires 3. Every dispute vote via session key fails on-chain. The recipient allowlist is documented as "backend-enforced" but is not actually checked anywhere in the current code.

---

## Part 1: Web3 contracts

### CRITICAL
None found.

---

### HIGH

#### W-H1 — Slashed member permanently blocks `payout` (stuck tanda)
**File/lines:** `Comadre.sol:400`, `Comadre.sol:488`

`payout` checks:
```solidity
if (tanda.contributionsThisTurn != tanda.memberTarget) revert E.MissingContributions();
```
`memberTarget` is the original capacity. `slashDefaulter` decrements `tanda.memberCurrent` (line 488) but never `tanda.memberTarget`. After a slash, only `(memberTarget - 1)` members remain active and can contribute. `contributionsThisTurn` can never reach `memberTarget` again. Every subsequent `payout` call reverts. The tanda is permanently stuck with USDC locked inside, including the remaining members' stakes.

**Concrete scenario:** 5-member tanda, member 3 slashed mid-round. Remaining 4 members all contribute. `contributionsThisTurn == 4`, `memberTarget == 5` → revert. Funds locked forever.

**Recommended fix:** Track `uint8 activeMembers` separately, decrement it in `slashDefaulter`, and use `activeMembers` in the payout completeness check and in the `gross` computation (`contributionAmount * activeMembers`).

---

### MEDIUM

#### W-M1 — `completeTanda` body is dead code (impossible guard)
**File/lines:** `Comadre.sol:440`

```solidity
if (tanda.currentTurn <= tanda.totalTurns) revert E.InvalidMemberCount();
```
`currentTurn` is incremented up to `totalTurns` by `payout`. When `currentTurn == totalTurns` and `payout` succeeds, it sets `state = Completed` directly (line 419-421). At that point `completeTanda` hits the early `return` at line 438. For all other cases where `currentTurn <= totalTurns`, the guard above reverts. `currentTurn` can never exceed `totalTurns` given the logic in `payout`. The function body is unreachable in all valid execution paths.

**Recommended fix:** Remove the `currentTurn <= totalTurns` guard. Document that `payout` is the sole completion path.

---

#### W-M2 — Dispute opener can vote on their own dispute
**File/lines:** `Comadre.sol:555-573`

`voteDispute` checks that the caller is an active member and has not voted before, but does not check `msg.sender != dispute.opener`. The dispute opener can immediately vote in their own favor after opening.

**Recommended fix:** Add `if (msg.sender == dispute.opener) revert E.Unauthorized();`

---

#### W-M3 — `voteDispute` does not verify `disputeKey` belongs to `tandaKey`
**File/lines:** `Comadre.sol:555`

`tandaKey` is used only to validate membership via `memberKeyOf(tandaKey, msg.sender)`. A caller who is a member of Tanda A can pass `disputeKey` from Tanda B and cast a vote on it using their Tanda A membership. No validation that the dispute belongs to the supplied tanda.

**Recommended fix:** Store `tandaKey` on the `Dispute` struct or verify `disputeKey == disputeKeyOf(tandaKey, dispute.disputeId)`.

---

#### W-M4 — KYC limit is checked once at join but not at `contribute`
**File/lines:** `Comadre.sol:316-317`

The KYC limit check at `joinTanda` tests `contribution + stake > kycLimits[tier]`. After joining, the oracle can downgrade a user's KYC tier, but `contribute` never re-checks the limit. A downgraded user can continue contributing at amounts above their new tier ceiling.

**Recommended fix:** Re-check KYC at `contribute`, or document that tier downgrade is not expected during an active tanda.

---

### LOW

#### W-L1 — Two `openDispute` calls in the same block produce a misleading error
**File/lines:** `Comadre.sol:521`

The second caller gets `TandaNotActive` (the tanda just became `Paused`). Not a fund-loss bug, but the error is misleading. Document as a known tx-ordering sensitivity.

#### W-L2 — `initUserProfile` is permissionless — front-run possible
**File/lines:** `Comadre.sol:194`

Anyone can register a profile for any address. An attacker can front-run a legitimate user's call with a different `phoneHash`, causing the legitimate call to revert with `AlreadyInitialized`. In the custodial model this is low-risk (backend controls ordering), but worth noting.

#### W-L3 — `MockUSDC.mint` has no access control
**File/lines:** `mocks/MockUSDC.sol:19`

Unrestricted minting. Fine for testnet; dangerous if accidentally deployed to a public environment used for user demos. Add a deployer-only guard.

---

## Part 2: Web2 backend

### CRITICAL

#### B-C1 — Double KMS decryption per transfer
**File/lines:** `apps/api/src/lib/monadSessionSigner.ts:61-86`

`signMonadTransfer` calls `kms.decryptSessionKey` on lines 61-66, stores the result as `plaintext`, then immediately calls `sessionKeyApi.signAndSendUserOp` with the same raw envelope on lines 68-77. `signAndSendUserOp` calls `decryptSessionKey` internally a second time (`packages/wallet-infra/src/sessionKey/sign.ts:49`). The result of the first call is discarded (`void plaintext` line 86).

Every transfer costs two KMS Decrypt calls: 2× latency, 2× cost, 2× exposure to KMS rate limits. The comment on line 86 confirms the first decrypt was supposed to be used but was abandoned when the call was delegated.

**Recommended fix:** Delete lines 61-66 and line 86 from `monadSessionSigner.ts`. Decryption should happen only inside `signAndSendUserOp`.

---

#### B-C2 — `install-session-key` has no DB transaction — partial writes on crash
**File/lines:** `apps/api/src/routes/onboarding.ts:333-385`

Four sequential DB writes, no transaction:
1. `INSERT INTO users` (conditional, line 334)
2. `INSERT INTO smart_wallets` (line 349)
3. `INSERT INTO session_keys` (line 362)
4. `UPDATE auth_sessions SET status='completed'` (line 380)

A crash after step 2 but before step 3 leaves a `smart_wallets` row with no `session_keys` row and `auth_sessions.status = 'pending'`. A replay hits the `smart_wallets` unique constraint and fails. User is permanently stuck: the magic link cannot complete, the wallet row is inconsistent.

**Recommended fix:** Wrap all four writes in `db.transaction(async (tx) => { ... })`.

---

### HIGH

#### B-H1 — ABI mismatch: `voteDispute` policy vs. contract (every vote fails on-chain)
**File/lines:** `packages/wallet-infra/src/sessionKey/policies.ts:33` vs. `Comadre.sol:555`

Policy ABI:
```ts
"function voteDispute(bytes32 disputeKey, bool continueTanda) external"
```
Contract signature:
```solidity
function voteDispute(bytes32 tandaKey, bytes32 disputeKey, bool continueTanda) external
```
The session-key call policy registers a 2-argument selector. The contract requires 3. Every dispute vote submitted via a session key will be rejected by the Kernel validator (wrong function selector in `toCallPolicy`) or will revert on-chain with a decode error.

**Recommended fix:** Update `policies.ts` line 33 to the 3-argument signature. Update `args: [null, null]` to `args: [null, null, null]`.

---

#### B-H2 — `monad/start` does not invalidate prior pending tokens for the same phone
**File/lines:** `apps/api/src/routes/onboarding.ts:182-211`

Each call inserts a new `auth_sessions` row without cancelling existing `pending` rows for the same `phoneHash`. Two active magic links can coexist for 15 minutes. If a user re-triggers onboarding and someone else intercepts the second link, both `/monad/finalize` calls can succeed (different tokens, same phone), potentially creating two competing `smart_wallets` rows for the same phone, or binding different owner addresses.

**Recommended fix:** Before inserting the new token, `UPDATE auth_sessions SET status='cancelled' WHERE phone_hash=$1 AND status='pending'`.

---

#### B-H3 — `phoneJwt` is never verified in `/monad/finalize`
**File/lines:** `apps/api/src/routes/onboarding.ts:269`

```ts
// V1: trust the token; phoneJwt verification deferred
```
The handler accepts any `privyUserId` and `ownerAddress` the client sends. A caller with a valid magic token can bind an arbitrary EVM address to the user's phone. This undermines the entire owner-key binding trust model.

**Recommended fix:** Call `verifyPrivyJwt(phoneJwt)` from `packages/wallet-infra/src/privy/index.ts`. Assert that the returned `ownerAddress` matches the POSTed value and that the phone in the JWT matches the `phoneHash` in the session row.

---

### MEDIUM

#### B-M1 — `sessionPkMemory` is process-local; multi-replica deployments lose session keys
**File/lines:** `apps/api/src/routes/onboarding.ts:138`

`sessionPkMemory` is an in-process `Map`. If the API runs on multiple replicas, `rememberSessionPk` on replica A is invisible to replica B. The client's `install-session-key` call routed to B returns `session_expired`. The private key is lost and the user must restart onboarding from scratch.

**Recommended fix:** Use a shared short-TTL store (Redis, or an encrypted `auth_sessions` column for the ephemeral key) so any replica can retrieve the key.

---

#### B-M2 — Zero-amount transfers are not rejected
**File/lines:** `apps/api/src/routes/transfersMonad.ts:67-75`

`usdcToMicro("0")` returns `0n`. The route does not reject zero-amount transfers — it creates a DB row and submits an on-chain `transfer(to, 0)`. USDC accepts zero-value transfers (ERC-20 spec). The result is a confirmed transfer row for 0 USDC, potentially confusing users and polluting transfer history.

**Recommended fix:** Add `if (microUsdc === 0n) return c.json({ error: "ZERO_AMOUNT" }, 400)` after `usdcToMicro`.

---

#### B-M3 — `signMonadTransfer` does not enforce `allowedRecipients` or `allowedContracts`
**File/lines:** `apps/api/src/lib/monadSessionSigner.ts:56-59`

`docs/WALLET_SECURITY.md §5` and `§11` specify that the backend must validate the recipient against `session_keys.allowedRecipients` before decrypting. Only `perCallCapMicroUsdc` is checked. `allowedRecipients` is installed as `[]` (empty) at onboarding, and never populated. No caller checks it. The "backend-enforces allowlist" claim in the security doc is not implemented.

**Recommended fix:** After the cap check, add: if `key.allowedRecipients.length > 0`, verify the recipient extracted from the calldata is in the list. Document clearly if the intended behavior is "no allowlist = any recipient allowed."

---

#### B-M4 — Self-transfer check is ambiguous during the Solana→Monad migration window
**File/lines:** `apps/api/src/routes/transfersMonad.ts:63-65`

During the dual-identity migration period, a single phone hash may map to two `users` rows (one Solana, one EVM). `lookupMonadByPhone` uses `LIMIT 1` without ordering. If the Solana row is returned for `senderPhone` (no smart wallet), the handler returns `SENDER_NOT_ONBOARDED` instead of `SELF_TRANSFER`. Non-critical but produces a wrong user-facing error.

**Recommended fix:** Order `lookupMonadByPhone` results by `smart_wallets.created_at DESC` to prefer the EVM row.

---

### LOW

#### B-L1 — `DAILY_VALIDITY_MS` and `DAILY_VALIDITY_SECONDS` are independent literals that can drift
**Files:** `apps/api/src/routes/onboarding.ts:131`, `packages/wallet-infra/src/sessionKey/policies.ts:12`

Both encode 30 days, but as separate constants. If one is updated without the other, the DB `valid_until` and the on-chain timestamp policy diverge. Sessions would appear active in DB but be rejected by the on-chain validator (or vice versa).

**Recommended fix:** Export `DAILY_VALIDITY_SECONDS` from `policies.ts` and import it in `onboarding.ts` (`DAILY_VALIDITY_SECONDS * 1000`).

#### B-L2 — `enviarPlata` passes `userWallet: ""` for a route that is already HMAC-authenticated
**File/lines:** `packages/agent-tools/src/tools.ts:735`

Functionally correct but misleading. `""` is used as convention for "no wallet" in onboarding tools and as "wallet not needed here" in `enviar_plata`. Future maintainers may incorrectly conclude the route lacks wallet-level auth.

---

## Cross-layer findings

#### X-1 — `voteDispute` ABI mismatch is both a policy bug (B-H1) and an on-chain rejection (W-H1 context)
The 2-argument policy selector is registered on the session key. The 3-argument contract selector is what Kernel validates against. No dispute vote will succeed through the agent path until both sides are fixed.

#### X-2 — Recipient allowlist: documented as "backend-enforced," not enforced anywhere
The on-chain policy intentionally omits recipient pinning (§10 of security doc). The backend is supposed to compensate. It does not (B-M3). The gap exists at both layers simultaneously. Until `allowedRecipients` is actually populated and checked server-side, any registered Comadre session key can transfer up to 50 USDC to any address.

---

## Open questions / unverified

| # | Question | Where it matters |
|---|----------|-----------------|
| OQ-1 | Does `hashPhone` in `@comadre/cache` produce the same SHA-256 hex as `hashPhoneSync` in `onboarding.ts`? If they differ, `lookupMonadByPhone` will never match the phone stored during onboarding. | `monadPhoneLookup.ts:9`, `onboarding.ts:159` |
| OQ-2 | Does Pimlico's bundler on Monad testnet support `waitForUserOperationReceipt` with a 5-minute timeout? If not, `signAndSendUserOp` will hang or throw unstructured errors. | `wallet-infra/src/sessionKey/sign.ts:81` |
| OQ-3 | `permissionId` is stored as `""` for all session keys (TODO on `onboarding.ts:367`). If ZeroDev's `uninstallPlugin` requires a correct `permissionId`, on-chain revocation via `revoke.ts` will silently fail or revert. | `onboarding.ts:367`, `sessionKey/revoke.ts` |
| OQ-4 | No migration path exists for `encryptionVersion` bumps. Rows encrypted under an old version will throw on any decrypt attempt after a version bump. | `kms/client.ts:57` |
| OQ-5 | `toTimestampPolicy` calls `Date.now()` at blob creation time (client-side, in browser during `approveSessionKey`). If the client clock is skewed forward, the on-chain session expires immediately after install. | `sessionKey/policies.ts:133`, `sessionKey/approve.ts` |
| OQ-6 | The stuck-tanda scenario (W-H1) needs a Foundry test with N=5, 1 slash, to confirm irreversibility and measure total locked USDC impact. | |

---

**Key files referenced:**
- `/Users/firrton/comadre/packages/monad-contracts/src/Comadre.sol`
- `/Users/firrton/comadre/packages/monad-contracts/src/libraries/ComadreTypes.sol`
- `/Users/firrton/comadre/packages/wallet-infra/src/sessionKey/policies.ts`
- `/Users/firrton/comadre/packages/wallet-infra/src/sessionKey/sign.ts`
- `/Users/firrton/comadre/packages/wallet-infra/src/kms/client.ts`
- `/Users/firrton/comadre/apps/api/src/routes/onboarding.ts`
- `/Users/firrton/comadre/apps/api/src/routes/transfersMonad.ts`
- `/Users/firrton/comadre/apps/api/src/lib/monadSessionSigner.ts`
