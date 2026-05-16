# @comadre/wallet-infra

The cryptographic security boundary of the Monad path. **All session-key custody and signing flows through this package.** A wrong edit here is a T2-class vulnerability (host compromise → fund loss). Read `docs/WALLET_SECURITY.md` before touching any file under `src/`.

## What this package owns

| Sub-path | Purpose | Key public exports |
|---|---|---|
| `src/kms/` | AWS KMS envelope encryption + AES-256-GCM helpers | `encryptSessionKey`, `decryptSessionKey`, `aesGcmEncrypt`, `aesGcmDecrypt`, `zeroize` |
| `src/sessionKey/` | Generate, approve, sign, revoke ZeroDev Kernel session keys | `generateSessionKey`, `approveSessionKey`, `signAndSendUserOp`, `revokeSessionKey`, `buildDailyPolicies`, `buildElevatedPolicies` |
| `src/otp/` | Twilio Verify SMS OTP | `startOtp`, `checkOtp` |
| `src/kernel/` | Counterfactual address derivation for Kernel v3.1 smart wallets | `counterfactualSmartWalletAddress` |
| `src/privy/` | Privy JWT verification for the onboarding callback | `verifyPrivyJwt` |
| `src/config.ts` | Zod-validated env-var loader (call `loadWalletInfraEnv()` lazily) | `loadWalletInfraEnv`, `pimlicoBundlerUrl`, `ENCRYPTION_VERSION` |
| `src/chains.ts` | viem-compatible Monad chain definitions | `monadTestnet` |

Everything that does NOT belong in this package: HTTP routing, DB schema, agent tool definitions. This package speaks crypto and chain, nothing else.

## Security invariants (do NOT break)

1. **Never call `decryptSessionKey` before the DB-level policy pre-check.** The caller MUST validate `perCallCapMicroUsdc`, `allowedRecipients`, `validUntil`, `status='active'`, etc. against the `session_keys` row BEFORE invoking any KMS decrypt. This is the cost-control gate AND the blast-radius bound. See `apps/api/src/lib/monadSessionSigner.ts` for the canonical call pattern.

2. **`zeroize(dek)` runs in `finally`.** Every place that holds a plaintext DEK in a `Buffer` MUST zero it after use. Do not remove the try/finally blocks in `src/kms/client.ts`.

3. **`sessionPrivateKey` is never logged, cached in app state, or returned to callers other than `signAndSendUserOp`.** It exists only inside the decrypt→sign window. Strings are immutable in JS so no zeroize is possible — keep the window as short as possible.

4. **`approveSessionKey` runs in the user's browser, not server-side.** The server only sees the resulting `serializedBlob` (which contains no private key). Do not import it into `apps/api`. (See audit COM-088 for the relocation TODO.)

5. **`encryptionVersion` is forward-only.** If you bump the AES/KMS scheme, you MUST write a migration that re-wraps existing rows. Existing rows under an old version will throw on decrypt. See audit OQ-4.

## Env vars (all required at runtime)

`loadWalletInfraEnv()` validates these at first call and throws hard if any are missing or malformed. Copy `.env.example` and fill in.

| Var | Purpose | Example |
|---|---|---|
| `MONAD_CHAIN_ID` | Monad chain (testnet 10143, mainnet 143) | `10143` |
| `MONAD_RPC_URL` | RPC endpoint | `https://testnet-rpc.monad.xyz` |
| `PRIVY_APP_ID` | Privy app | `clxxxxxxxxxxxxxx` |
| `PRIVY_APP_SECRET` | Privy server secret | (32+ char secret) |
| `PIMLICO_API_KEY` | Pimlico bundler + paymaster key | `pim_xxxxxx` |
| `PIMLICO_PAYMASTER_ENABLED` | `"true"` to sponsor gas; default `"true"` | `true` |
| `AWS_REGION` | KMS region | `us-east-1` |
| `KMS_KEY_ARN` | Symmetric KMS key ARN | `arn:aws:kms:us-east-1:123456789012:key/abc-...` |
| `COMADRE_CONTRACT_ADDRESS` | Deployed Comadre.sol (optional during scaffold) | `0x...` |
| `USDC_CONTRACT_ADDRESS` | USDC ERC-20 (testnet: MockUSDC) | `0x...` |
| `TWILIO_ACCOUNT_SID` | Twilio account | `ACxxxx` |
| `TWILIO_AUTH_TOKEN` | Twilio auth | (token) |
| `TWILIO_VERIFY_SERVICE_SID` | Twilio Verify service | `VAxxxx` |
| `ONBOARDING_BASE_URL` | Where the magic-link page lives | `https://comadre.app` |

## Local dev — how to bootstrap without spending money

**Option A: KMS-skipping unit tests.** `src/kms/aesGcm.test.ts` uses `randomBytes(32)` as DEK — no real KMS call. Run with `bun test src/kms/aesGcm.test.ts`. AES-GCM correctness is fully covered without an AWS account.

**Option B: Local KMS via LocalStack.** Start LocalStack with KMS enabled (`localstack start -d`), create a symmetric key (`awslocal kms create-key --key-spec SYMMETRIC_DEFAULT`), point `AWS_REGION=us-east-1` and `KMS_KEY_ARN` at the local key. Cost: $0. Limitation: doesn't validate real IAM policies.

**Option C: Real AWS KMS.** $1/month per symmetric CMK, $0.03 per 10k API requests (first 20k/month free). Provision: `aws kms create-key --key-usage ENCRYPT_DECRYPT --key-spec SYMMETRIC_DEFAULT`, then alias and attach an IAM policy granting only `kms:GenerateDataKey` and `kms:Decrypt` to the app's role. CloudTrail logs every decrypt.

## How session-key signing actually flows

```
agent tool / route
    ↓ pre-check (perCallCap, allowedRecipients, validUntil, status)
    ↓ calls sessionKeyApi.signAndSendUserOp({ envelope, to, data })
        ↓ KMS.Decrypt(envelope.dekCiphertext)  ← THIS is the cost-controlled gate
        ↓ aesGcmDecrypt(envelope.ciphertext, dek)
        ↓ deserializePermissionAccount(...)
        ↓ kernelClient.sendUserOperation(callData)
        ↓ Pimlico bundles + submits on-chain
        ↓ zeroize(dek)
    ↓ returns { userOpHash, txHash }
```

See `apps/api/src/lib/monadSessionSigner.ts` for the canonical pre-check + invocation. See `docs/WALLET_SECURITY.md` §5 (daily ops) and §11 (read-before-decrypt) for the design rationale.

## Known gaps (tracked in `docs/audits/00-master-findings.md`)

- **COM-004** — backend recipient allowlist is documented in §10 but not enforced. The signer only checks the per-call cap today. Until this lands, any registered Comadre session key can transfer up to 50 USDC to ANY address.
- **COM-033** — `permissionId` is persisted as empty string. On-chain revocation via `uninstallValidator(permissionId)` (documented in WALLET_SECURITY.md §7) is unavailable until this is wired. Soft revoke (DB row deletion) still works.
- **COM-088** — `sessionKey/approve.ts` is browser code in a server-side package. Move to `apps/web/lib/sessionKey/`.

## Tests

```sh
pnpm test               # all tests in this package (uses bun internally)
pnpm typecheck          # tsc --noEmit
```

Tests live next to the code they cover (e.g. `kms/aesGcm.test.ts`).
