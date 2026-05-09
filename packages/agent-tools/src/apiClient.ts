/**
 * Internal HTTP client for calling `apps/api` with HMAC-SHA256 signature.
 *
 * Every agent-tool call goes through this layer — it is the ONLY mechanism by
 * which agent tools touch the backend. Tools NEVER hit the chain directly.
 *
 * Auth model:
 *   - The agent service signs each request with the shared `INTERNAL_HMAC_SECRET`
 *   - `apps/api` verifies the signature on its `/api/v1/...` endpoints
 *   - In dev (NODE_ENV !== "production") we ALSO send `X-Dev-Wallet` and
 *     `X-Dev-User-Id` so the API's dev-mode bypass works without Privy JWT
 */
import crypto from "node:crypto";
import { env } from "@comadre/config";

export interface ApiCallParams {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  /** The user we're acting on behalf of (base58 Solana pubkey). */
  userWallet: string;
  /** Required on POST. Avoids replay + duplicate effect. */
  idempotencyKey?: string;
}

function signRequest(secret: string, method: string, path: string, body: string, timestamp: string): string {
  const payload = `${method}\n${path}\n${timestamp}\n${body}`;
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

export async function apiCall<T>(params: ApiCallParams): Promise<T> {
  if (params.method === "POST" && !params.idempotencyKey) {
    throw new Error(`apiCall: POST ${params.path} requires an idempotencyKey`);
  }

  const url = `${env.API_URL}${params.path}`;
  const bodyStr = params.body !== undefined ? JSON.stringify(params.body) : "";
  const timestamp = String(Date.now());
  const signature = signRequest(env.INTERNAL_HMAC_SECRET, params.method, params.path, bodyStr, timestamp);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Internal-Signature": signature,
    "X-Internal-Timestamp": timestamp,
    "X-Dev-Wallet": params.userWallet,
    "X-Dev-User-Id": `agent-tool:${params.userWallet}`,
  };
  if (params.idempotencyKey) headers["X-Idempotency-Key"] = params.idempotencyKey;

  const response = await fetch(url, {
    method: params.method,
    headers,
    body: params.method === "POST" ? bodyStr : undefined,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "<no body>");
    throw new Error(`API ${params.method} ${params.path} -> ${response.status}: ${errorBody}`);
  }
  return (await response.json()) as T;
}

/** Generate a UUID v4 for idempotency keys. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
