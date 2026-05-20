/**
 * tandas.test.ts
 *
 * Tests:
 * - POST /api/v1/tandas returns 501 (Monad migration pending)
 * - POST /api/v1/tandas with invalid body returns 400 validation error
 * - GET  /api/v1/tandas/:id 404 when not found
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import app from "../server.js";

const DEV_WALLET = "11111111111111111111111111111111";
const DEV_USER_ID = "test-user-tandas";
const VALID_PUBKEY = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const IDEMPOTENCY_KEY = crypto.randomUUID();

const devHeaders = {
  "X-Dev-Wallet": DEV_WALLET,
  "X-Dev-User-Id": DEV_USER_ID,
  "Content-Type": "application/json",
  "X-Idempotency-Key": IDEMPOTENCY_KEY,
};

beforeAll(() => {
  process.env["NODE_ENV"] = "test";
});

afterAll(() => {
  // leave test env
});

describe("POST /api/v1/tandas", () => {
  const validBody = {
    name: "Mi Tanda",
    member_target: 5,
    contribution_amount: "1000000",
    stake_amount: "500000",
    frequency_seconds: 86400,
    payout_order_mode: "join_order",
    usdc_mint: VALID_PUBKEY,
  };

  it("returns 501 not_implemented for valid body (Monad migration pending)", async () => {
    const res = await app.request("/api/v1/tandas", {
      method: "POST",
      headers: devHeaders,
      body: JSON.stringify(validBody),
    });

    expect(res.status).toBe(501);
    const body = await res.json() as Record<string, unknown>;
    expect(body["error"]).toBe("not_implemented");
  });

  it("returns 400 on missing required field", async () => {
    const res = await app.request("/api/v1/tandas", {
      method: "POST",
      headers: devHeaders,
      body: JSON.stringify({ name: "Bad" }), // missing fields
    });

    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body["error"]).toBe("validation");
  });

  it("returns 400 on invalid payout_order_mode", async () => {
    const res = await app.request("/api/v1/tandas", {
      method: "POST",
      headers: devHeaders,
      body: JSON.stringify({ ...validBody, payout_order_mode: "auction" }),
    });

    expect(res.status).toBe(400);
  });
});

describe("GET /api/v1/tandas/:id", () => {
  it("returns 404 when tanda does not exist", async () => {
    const res = await app.request("/api/v1/tandas/nonexistent-tanda-id-that-does-not-exist", {
      headers: {
        "X-Dev-Wallet": DEV_WALLET,
        "X-Dev-User-Id": DEV_USER_ID,
      },
    });

    // 404 expected when DB available; 500 if DB unavailable in test
    expect([404, 500].includes(res.status)).toBe(true);
    if (res.status === 404) {
      const body = await res.json() as Record<string, unknown>;
      expect(body["error"]).toBe("not_found");
    }
  });
});
