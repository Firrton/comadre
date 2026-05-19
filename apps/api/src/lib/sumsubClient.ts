/**
 * Sumsub REST API client — HMAC-SHA256 signed requests.
 *
 * Auth model:
 *   X-App-Token: SUMSUB_APP_TOKEN
 *   X-App-Access-Ts: Unix timestamp in seconds (string)
 *   X-App-Access-Sig: HMAC-SHA256( ts + METHOD + path + body ) using SUMSUB_SECRET_KEY
 *
 * Reference: https://developers.sumsub.com/api-reference/#section/Authentication
 */

import { createHmac } from "node:crypto";
import { env } from "@comadre/config";

const SUMSUB_BASE_URL = "https://api.sumsub.com";

function buildSignature(
  secretKey: string,
  timestamp: number,
  method: string,
  path: string,
  body: string,
): string {
  const message = `${timestamp}${method.toUpperCase()}${path}${body}`;
  return createHmac("sha256", secretKey).update(message).digest("hex");
}

async function sumsubRequest<T>(
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const appToken = env.SUMSUB_APP_TOKEN;
  const secretKey = env.SUMSUB_SECRET_KEY;

  if (!appToken || !secretKey) {
    throw new Error("[sumsubClient] SUMSUB_APP_TOKEN or SUMSUB_SECRET_KEY not configured");
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const bodyString = body !== undefined ? JSON.stringify(body) : "";

  const signature = buildSignature(secretKey, timestamp, method, path, bodyString);

  const headers: Record<string, string> = {
    "X-App-Token": appToken,
    "X-App-Access-Ts": String(timestamp),
    "X-App-Access-Sig": signature,
    "Accept": "application/json",
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${SUMSUB_BASE_URL}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: bodyString } : {}),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "(no body)");
    throw new Error(`[sumsubClient] ${method} ${path} → ${response.status}: ${text}`);
  }

  return response.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

interface SumsubApplicantResponse {
  id: string;
  [key: string]: unknown;
}

/**
 * Creates a Sumsub applicant for the given external user.
 * Returns the Sumsub-assigned applicantId.
 */
export async function createApplicant(params: {
  externalUserId: string;
  levelName: string;
}): Promise<{ applicantId: string }> {
  const path = `/resources/applicants?levelName=${encodeURIComponent(params.levelName)}`;
  const result = await sumsubRequest<SumsubApplicantResponse>("POST", path, {
    externalUserId: params.externalUserId,
  });
  return { applicantId: result.id };
}

interface SumsubAccessTokenResponse {
  token: string;
  userId: string;
}

/**
 * Generates a short-lived Sumsub access token for the hosted verification page.
 * Returns the token and the hosted verification URL.
 */
export async function generateAccessToken(params: {
  externalUserId: string;
  levelName: string;
}): Promise<{ token: string; url: string }> {
  const path = `/resources/accessTokens?userId=${encodeURIComponent(params.externalUserId)}&levelName=${encodeURIComponent(params.levelName)}`;
  const result = await sumsubRequest<SumsubAccessTokenResponse>("POST", path);
  const url = `https://cockpit.sumsub.com/checkus#/accessToken=${result.token}`;
  return { token: result.token, url };
}
