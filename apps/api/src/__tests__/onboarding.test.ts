/**
 * onboarding.test.ts — internal-auth guard for phone onboarding.
 *
 * Tests the requireInternalSignature middleware and request validation
 * on the /monad/start route (Monad onboarding entry point).
 *
 * Note: POST /init (legacy Solana onboarding) was removed in the Monad
 * migration and now returns 410. These tests cover its replacement.
 *
 * We intentionally stop at auth/validation here. The happy path talks to
 * Privy + Postgres and belongs in integration/E2E tests.
 */
import { createHmac } from "node:crypto";
import { describe, it, expect, beforeAll } from "bun:test";
import app from "../server.js";

const SECRET = "test-hmac-secret-at-least-32-chars-long";
// /monad/start is the Monad replacement for the removed /init route.
const PATH = "/api/v1/onboarding/monad/start";

function sign(method: string, path: string, body: string, timestamp: string): string {
  const payload = `${method}\n${path}\n${timestamp}\n${body}`;
  return createHmac("sha256", SECRET).update(payload).digest("hex");
}

function signedHeaders(body: string, timestamp = String(Date.now())) {
  return {
    "Content-Type": "application/json",
    "X-Internal-Timestamp": timestamp,
    "X-Internal-Signature": sign("POST", PATH, body, timestamp),
  };
}

beforeAll(() => {
  process.env["NODE_ENV"] = "test";
  process.env["INTERNAL_HMAC_SECRET"] = SECRET;
});

describe("POST /api/v1/onboarding/monad/start", () => {
  it("rejects requests without internal signature", async () => {
    const res = await app.request(PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+528116346072" }),
    });

    expect(res.status).toBe(401);
  });

  it("rejects invalid internal signature", async () => {
    const body = JSON.stringify({ phone: "+528116346072" });
    const res = await app.request(PATH, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Timestamp": String(Date.now()),
        "X-Internal-Signature": "0".repeat(64),
      },
      body,
    });

    expect(res.status).toBe(401);
  });

  it("rejects expired internal signatures", async () => {
    const body = JSON.stringify({ phone: "+528116346072" });
    const oldTimestamp = String(Date.now() - 10 * 60 * 1000);
    const res = await app.request(PATH, {
      method: "POST",
      headers: signedHeaders(body, oldTimestamp),
      body,
    });

    expect(res.status).toBe(401);
  });

  it("runs JSON validation after valid internal auth", async () => {
    const body = JSON.stringify({ phone: "not-e164" });
    const res = await app.request(PATH, {
      method: "POST",
      headers: signedHeaders(body),
      body,
    });

    expect(res.status).toBe(400);
    const payload = (await res.json()) as Record<string, unknown>;
    expect(payload["error"]).toBe("validation");
  });
});
