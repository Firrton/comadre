/**
 * Helius priority-fee estimation with a safe local fallback.
 *
 * Helius RPC exposes a custom JSON-RPC method `getPriorityFeeEstimate` that
 * returns a dynamic microLamports/CU recommendation based on recent congestion.
 * Docs: https://docs.helius.dev/solana-apis/priority-fee-api
 *
 * For non-Helius RPCs (or when the call errors), we fall back to a conservative
 * 1000 microLamports/CU which is enough for non-congested periods on devnet.
 */
import { getConnection } from "./connection";

export type PriorityLevel = "Min" | "Low" | "Medium" | "High" | "VeryHigh" | "UnsafeMax";

const FALLBACK_MICRO_LAMPORTS = 1000;

interface HeliusPriorityFeeResponse {
  jsonrpc?: string;
  id?: number;
  result?: {
    priorityFeeEstimate?: number;
    priorityFeeLevels?: Record<string, number>;
  };
  error?: { code: number; message: string };
}

/**
 * Estimate the priority fee in microLamports/CU for a transaction.
 *
 * @param accountKeys all account pubkeys (base58) the tx touches; Helius uses
 *                    these to scope the estimate to "fees you'd compete with".
 * @param level Helius priority level. Default `"Medium"`.
 */
export async function getPriorityFeeMicroLamports(
  accountKeys: string[],
  level: PriorityLevel = "Medium"
): Promise<number> {
  const connection = getConnection();
  try {
    const response = await fetch(connection.rpcEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getPriorityFeeEstimate",
        params: [{ accountKeys, options: { priorityLevel: level } }],
      }),
    });
    if (!response.ok) return FALLBACK_MICRO_LAMPORTS;
    const data = (await response.json()) as HeliusPriorityFeeResponse;
    const estimate = data.result?.priorityFeeEstimate;
    if (typeof estimate === "number" && Number.isFinite(estimate) && estimate > 0) {
      return Math.ceil(estimate);
    }
  } catch {
    // ignore; fall through to fallback
  }
  return FALLBACK_MICRO_LAMPORTS;
}
