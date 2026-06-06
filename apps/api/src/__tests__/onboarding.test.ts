/**
 * onboarding.test.ts — internal-auth guard for legacy /init.
 *
 * /init is a 410 tombstone (legacy Solana onboarding; replaced by /monad/start).
 * These tests verify the internal-HMAC guard still runs (401 on bad/missing/
 * expired signatures) and that the route returns 410 once authenticated.
 */
import { createHmac } from "node:crypto";
import { describe, it, expect, beforeAll } from "bun:test";
import app from "../server.js";

const SECRET = "test-hmac-secret-at-least-32-chars-long";
const PATH = "/api/v1/onboarding/init";

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

describe("POST /api/v1/onboarding/init", () => {
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

  it("returns 410 Gone after valid internal auth (legacy /init removed)", async () => {
    const body = JSON.stringify({ phone: "+528116346072" });
    const res = await app.request(PATH, {
      method: "POST",
      headers: signedHeaders(body),
      body,
    });

    expect(res.status).toBe(410);
    const payload = (await res.json()) as Record<string, unknown>;
    expect(payload["error"]).toBe("gone");
  });
});
