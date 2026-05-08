/**
 * auth.test.ts — auth middleware tests
 *
 * Tests:
 * - Missing JWT returns 401
 * - Dev-mode header (X-Dev-Wallet + X-Dev-User-Id) works in NODE_ENV=test
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import app from "../server.js";

const DEV_WALLET = "11111111111111111111111111111111";
const DEV_USER_ID = "test-user-id";

describe("Auth middleware", () => {
  let originalNodeEnv: string | undefined;

  beforeAll(() => {
    originalNodeEnv = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "test";
  });

  afterAll(() => {
    process.env["NODE_ENV"] = originalNodeEnv;
  });

  it("returns 401 when Authorization header is missing", async () => {
    const res = await app.request("/api/v1/users/me");
    expect(res.status).toBe(401);
  });

  it("returns 401 when Bearer token is invalid", async () => {
    const res = await app.request("/api/v1/users/me", {
      headers: { Authorization: "Bearer invalid-token" },
    });
    expect(res.status).toBe(401);
  });

  it("allows dev-mode headers in test environment", async () => {
    // /api/v1/users/me will reach the DB and return 404 (no user seeded)
    // but auth must pass (not 401)
    const res = await app.request("/api/v1/users/me", {
      headers: {
        "X-Dev-Wallet": DEV_WALLET,
        "X-Dev-User-Id": DEV_USER_ID,
      },
    });

    // 404 = auth passed, user not found in DB (expected in unit test)
    // 500 = DB not available (also acceptable — means auth passed)
    expect([404, 500].includes(res.status)).toBe(true);
  });

  it("rejects dev-mode headers in production", async () => {
    const oldEnv = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "production";

    try {
      const res = await app.request("/api/v1/users/me", {
        headers: {
          "X-Dev-Wallet": DEV_WALLET,
          "X-Dev-User-Id": DEV_USER_ID,
        },
      });

      // Without a real Privy token in production, must be 401
      expect(res.status).toBe(401);
    } finally {
      process.env["NODE_ENV"] = oldEnv;
    }
  });
});
