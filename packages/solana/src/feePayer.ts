/**
 * Backend signing keypairs loaded from base58-encoded env secrets.
 *
 * Cached per-key so we don't re-decode on every call. The cache is process-local;
 * each service holds its own copy.
 *
 * Files NEVER touch disk — all keypairs come from env vars set by the deploy target
 * (Railway / Fly / .env.local in dev).
 */
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { env } from "@comadre/config";

const cache = new Map<string, Keypair>();

function loadFromBase58(name: string, base58: string): Keypair {
  const cached = cache.get(name);
  if (cached) return cached;

  let secretKey: Uint8Array;
  try {
    secretKey = bs58.decode(base58);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`${name}: invalid base58 secret key (${reason})`);
  }
  if (secretKey.length !== 64) {
    throw new Error(`${name}: secret key must be 64 bytes (got ${secretKey.length})`);
  }
  const kp = Keypair.fromSecretKey(secretKey);
  cache.set(name, kp);
  return kp;
}

/** Sponsor wallet — pays SOL rent + tx fees on behalf of users. */
export function getFeePayerKeypair(): Keypair {
  return loadFromBase58("FEE_PAYER_SK", env.FEE_PAYER_SK);
}

/** Backend authority allowed to call non-financial cranks (`payout`, `complete_tanda`, `slash_defaulter`, `resolve_dispute`). */
export function getCrankAuthorityKeypair(): Keypair {
  return loadFromBase58("CRANK_AUTHORITY_SK", env.CRANK_AUTHORITY_SK);
}

/** Backend authority that signs `update_kyc_tier` once Sumsub returns a verdict. */
export function getKycOracleKeypair(): Keypair {
  return loadFromBase58("KYC_ORACLE_SK", env.KYC_ORACLE_SK);
}

/** Program admin — calls `init_config`, `pause`/`unpause`. Becomes a Squads multisig in mainnet. */
export function getAdminKeypair(): Keypair {
  return loadFromBase58("ADMIN_SK", env.ADMIN_SK);
}

/** Test-only: clear the cache so a different env var can be loaded next call. */
export function _resetKeypairCache(): void {
  cache.clear();
}
