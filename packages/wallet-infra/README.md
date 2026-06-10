# @comadre/wallet-infra

The cryptographic security boundary of the Monad path. **All session-key custody and signing flows through this package.** A wrong edit here is a T2-class vulnerability (host compromise → fund loss). Read `docs/WALLET_SECURITY.md` before touching any file under `src/`.

## What this package owns

| Sub-path | Purpose | Key public exports |
|---|---|---|
| `src/sessionKey/` | Generate, approve, sign, revoke ZeroDev Kernel session keys | `generateSessionKey`, `approveSessionKey`, `signAndSendUserOp`, `revokeSessionKey`, `buildDailyPolicies`, `buildElevatedPolicies` |
| `src/otp/` | Twilio Verify SMS OTP | `startOtp`, `checkOtp` |
| `src/kernel/` | Counterfactual address derivation for Kernel v3.1 smart wallets | `counterfactualSmartWalletAddress` |
| `src/privy/` | Privy JWT verification for the onboarding callback | `verifyPrivyJwt` |
| `src/config.ts` | Zod-validated env-var loader (call `loadWalletInfraEnv()` lazily) | `loadWalletInfraEnv`, `pimlicoBundlerUrl` |
| `src/chains.ts` | viem-compatible Monad chain definitions | `monadTestnet` |

Everything that does NOT belong in this package: HTTP routing, DB schema, agent tool definitions. This package speaks crypto and chain, nothing else.

## Security invariants (do NOT break)

1. **Never invoke `signAndSendUserOp` before the DB-level policy pre-check.** The caller MUST validate `perCallCapMicroUsdc`, `allowedRecipients`, `validUntil`, `status='active'`, etc. against the `session_keys` row BEFORE calling the signer. This is the cost-control gate AND the blast-radius bound. See `apps/api/src/lib/monadSessionSigner.ts` for the canonical call pattern.

2. **`sessionPrivateKey` is never logged, cached in app state, or returned to callers other than `signAndSendUserOp`.** The private key lives inside Turnkey — the backend never materialises it. Keep the Turnkey viem account within the narrowest scope possible.

3. **`approveSessionKey` runs in the user's browser, not server-side.** The server only sees the resulting `serializedBlob` (which contains no private key). Do not import it into `apps/api`. (See audit COM-088 for the relocation TODO.)

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
| `COMADRE_CONTRACT_ADDRESS` | Deployed Comadre.sol (optional during scaffold) | `0x...` |
| `USDC_CONTRACT_ADDRESS` | USDC ERC-20 (testnet: MockUSDC) | `0x...` |
| `TWILIO_ACCOUNT_SID` | Twilio account | `ACxxxx` |
| `TWILIO_AUTH_TOKEN` | Twilio auth | (token) |
| `TWILIO_VERIFY_SERVICE_SID` | Twilio Verify service | `VAxxxx` |
| `ONBOARDING_BASE_URL` | Where the magic-link page lives | `https://comadre.app` |

## Local dev — how to bootstrap without spending money

Session-key custody moved to Turnkey. AWS KMS is no longer required. Set `TURNKEY_API_PUBLIC_KEY`, `TURNKEY_API_PRIVATE_KEY`, and `TURNKEY_ORGANIZATION_ID` from the Turnkey dashboard and the signing flow works in testnet without any AWS credentials.

## How session-key signing actually flows

```
agent tool / route
    ↓ pre-check (perCallCap, allowedRecipients, validUntil, status)
    ↓ calls signAndSendUserOp({ subOrgId, walletId, serializedPermissionBlob, to, data })
        ↓ Turnkey: createAccount(subOrgId, walletId)  ← private key never leaves Turnkey
        ↓ deserializePermissionAccount(serializedPermissionBlob)
        ↓ kernelClient.sendUserOperation(callData)
        ↓ Pimlico bundles + submits on-chain
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

Tests live next to the code they cover (e.g. `src/__tests__/config.test.ts`).
