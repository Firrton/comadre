/**
 * Submit a fully-signed `VersionedTransaction` with exponential backoff and
 * blockhash-expiry detection.
 *
 * Used by services that broadcast directly (cron jobs, indexer reindex script,
 * `init_config` bootstrap). NOT used by `apps/api` — the API returns unsigned
 * txs and the user's wallet broadcasts them.
 *
 * On blockhash expiry the caller is responsible for rebuilding the tx with a
 * fresh blockhash and retrying — we surface a distinct error message so the
 * caller can handle it.
 */
import type { Connection, SendOptions, VersionedTransaction } from "@solana/web3.js";
import { getConnection } from "./connection";

export interface SubmitOptions {
  connection?: Connection;
  /** Total number of attempts (including the first). Default 3. */
  maxAttempts?: number;
  /** Initial backoff delay in ms. Doubles between retries. Default 500. */
  initialDelayMs?: number;
  /** Pass-through `sendTransaction` options. */
  sendOptions?: SendOptions;
}

export interface SubmitResult {
  signature: string;
  attempts: number;
}

const BLOCKHASH_EXPIRED_MARKERS = ["blockhash not found", "BlockhashNotFound", "block height exceeded"];

export async function submitWithRetry(tx: VersionedTransaction, opts: SubmitOptions = {}): Promise<SubmitResult> {
  const connection = opts.connection ?? getConnection();
  const maxAttempts = opts.maxAttempts ?? 3;
  const initialDelay = opts.initialDelayMs ?? 500;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const signature = await connection.sendTransaction(tx, {
        skipPreflight: false,
        maxRetries: 0,
        ...opts.sendOptions,
      });

      const latest = await connection.getLatestBlockhash("confirmed");
      const confirmation = await connection.confirmTransaction(
        {
          signature,
          blockhash: latest.blockhash,
          lastValidBlockHeight: latest.lastValidBlockHeight,
        },
        "confirmed"
      );
      if (confirmation.value.err !== null) {
        throw new Error(`tx ${signature} confirmed with error: ${JSON.stringify(confirmation.value.err)}`);
      }
      return { signature, attempts: attempt };
    } catch (err) {
      lastErr = err;
      const message = err instanceof Error ? err.message : String(err);
      if (BLOCKHASH_EXPIRED_MARKERS.some((m) => message.includes(m))) {
        throw new Error(
          `tx blockhash expired after ${attempt} attempts. Caller should rebuild and resubmit.`
        );
      }
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, initialDelay * 2 ** (attempt - 1)));
      }
    }
  }
  const reason = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(`tx failed after ${maxAttempts} attempts: ${reason}`);
}
