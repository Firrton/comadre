/**
 * Internal HTTP client for calling `apps/api` with HMAC-SHA256 signature.
 *
 * Every agent-tool call goes through this layer — it is the ONLY mechanism by
 * which agent tools touch the backend. Tools NEVER hit the chain directly.
 *
 * Auth model:
 *   - The agent service signs each request with the shared `INTERNAL_HMAC_SECRET`
 *   - `apps/api` verifies the signature on its `/api/v1/...` endpoints
 *   - Audit COM-006: dev-bypass headers (X-Dev-Wallet / X-Dev-User-Id) are sent
 *     ONLY when NODE_ENV === "development". Previously they were sent always,
 *     which combined with a misconfigured production NODE_ENV could turn the
 *     HMAC secret into a master key over every user.
 */
import crypto from "node:crypto";
import { env } from "@comadre/config";

export interface ApiCallParams {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  /** The user we're acting on behalf of (users.id UUID). */
  userId?: string;
  /** Required on POST. Avoids replay + duplicate effect. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export type ResolveTransferConfirmationResult =
  | { handled: false }
  | {
      handled: true;
      outcome: "confirmed" | "failed" | "cancelled" | "reprompted";
      reply: string;
      txHash?: string;
    };

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
  };
  // Audit COM-006: dev-bypass headers gated on NODE_ENV === "development".
  // Identity is users.id (UUID); X-Dev-Wallet carries a non-empty placeholder to
  // satisfy the dev gate (owner address is not needed to identify the user).
  if (process.env["NODE_ENV"] === "development" && params.userId) {
    headers["X-Dev-User-Id"] = params.userId;
    headers["X-Dev-Wallet"] = params.userId;
  }
  if (params.idempotencyKey) headers["X-Idempotency-Key"] = params.idempotencyKey;

  const response = await fetch(url, {
    method: params.method,
    headers,
    body: params.method === "POST" ? bodyStr : undefined,
    signal: params.signal,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "<no body>");
    throw new Error(`API ${params.method} ${params.path} -> ${response.status}: ${errorBody}`);
  }
  return (await response.json()) as T;
}

export async function resolveTransferConfirmation(
  senderPhone: string,
  message: string,
): Promise<ResolveTransferConfirmationResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    return await apiCall<ResolveTransferConfirmationResult>({
      method: "POST",
      path: "/api/v1/transfers-monad/resolve-confirmation",
      idempotencyKey: newIdempotencyKey(),
      body: { senderPhone, message },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

/** Generate a UUID v4 for idempotency keys. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
