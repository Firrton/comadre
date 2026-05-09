/**
 * Privy server-side Solana signer.
 *
 * Wraps `privy.walletApi.solana.signTransaction({ walletId, transaction })`
 * which signs a `VersionedTransaction` server-side using the user's embedded
 * wallet — controlled by Privy, authorized by the user's authenticated session.
 *
 * Reference: @privy-io/server-auth 1.32.5 dist/cjs/wallet-api/rpc/solana.js
 *   class SolanaRpcApi {
 *     signTransaction({ walletId, transaction }): Promise<{ signedTransaction }>
 *     signAndSendTransaction({...})
 *     signMessage({...})
 *   }
 *
 * We use `signTransaction` (not `signAndSendTransaction`) so we keep control
 * over `submitWithRetry` for blockhash refresh + backoff.
 *
 * The authorization model assumes the upstream caller has already authenticated
 * the user via Privy JWT (handled in `authMiddleware`). The user's `walletId`
 * is read from the linked accounts in the JWT claims and passed here.
 */

import type { Transaction, VersionedTransaction } from "@solana/web3.js";
import { PrivyClient } from "@privy-io/server-auth";

let _privy: PrivyClient | null = null;

function getPrivy(): PrivyClient {
  if (_privy !== null) return _privy;
  const appId = process.env["PRIVY_APP_ID"];
  const appSecret = process.env["PRIVY_APP_SECRET"];
  if (!appId || !appSecret) {
    throw new Error("[privy-signer] PRIVY_APP_ID and PRIVY_APP_SECRET are required");
  }
  _privy = new PrivyClient(appId, appSecret);
  return _privy;
}

/**
 * Validate at module init that the Solana wallet-api surface exists. Fail fast
 * if the SDK shape changed across versions — better than a runtime mystery.
 */
export function assertPrivySolanaCapability(): void {
  const privy = getPrivy();
  const wapi = (privy as unknown as { walletApi?: { solana?: { signTransaction?: unknown } } }).walletApi;
  if (!wapi?.solana?.signTransaction) {
    throw new Error(
      "[privy-signer] privy.walletApi.solana.signTransaction is not available. " +
        "Required minimum: @privy-io/server-auth >= 1.32.5"
    );
  }
}

export interface SignWithPrivyParams {
  /** Privy wallet ID for the user's embedded Solana wallet. */
  walletId: string;
  /** Pre-built `VersionedTransaction` (typically partial-signed by fee_payer). */
  transaction: VersionedTransaction;
  /** Optional idempotency key forwarded to Privy. */
  idempotencyKey?: string;
}

export interface SignWithPrivyResult {
  /** The transaction with the user's signature added (in addition to existing signers). */
  signedTransaction: VersionedTransaction;
}

/**
 * Sign a transaction with the user's Privy embedded Solana wallet.
 *
 * The returned `VersionedTransaction` may have additional signers already attached
 * (e.g. from `buildUnsignedTx` partial-signing by `fee_payer`); Privy adds the
 * user's signature and returns the same structure.
 */
export async function signWithPrivy(params: SignWithPrivyParams): Promise<SignWithPrivyResult> {
  const privy = getPrivy();
  // Type-cast the wallet API to access the Solana namespace; the SDK exports
  // it under `walletApi.solana` per the dist source.
  const solana = (privy as unknown as {
    walletApi: {
      solana: {
        signTransaction: (input: {
          walletId: string;
          transaction: VersionedTransaction | Transaction;
          idempotencyKey?: string;
        }) => Promise<{ signedTransaction: VersionedTransaction | Transaction }>;
      };
    };
  }).walletApi.solana;

  const result = await solana.signTransaction({
    walletId: params.walletId,
    transaction: params.transaction,
    idempotencyKey: params.idempotencyKey,
  });

  // We always pass VersionedTransaction in; Privy returns the same type back.
  return { signedTransaction: result.signedTransaction as VersionedTransaction };
}
