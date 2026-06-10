/**
 * auth.test.ts — auth middleware tests
 *
 * Tests:
 * - Missing JWT returns 401
 * - Dev-mode header (X-Dev-Wallet + X-Dev-User-Id) works in NODE_ENV=test
 * - Dev-mode resolves user.id from X-Dev-User-Id (UUID identity)
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import app from "../server.js";
import { authMiddleware, type AuthUser } from "../middlewares/auth.js";

const DEV_WALLET = "11111111111111111111111111111111";
const DEV_USER_ID = "test-user-id";

describe("Auth middleware", () => {
  let originalNodeEnv: string | undefined;
  let originalBypass: string | undefined;

  beforeAll(() => {
    originalNodeEnv = process.env["NODE_ENV"];
    originalBypass = process.env["DEV_AUTH_BYPASS"];
    process.env["NODE_ENV"] = "test";
    process.env["DEV_AUTH_BYPASS"] = "true";
  });

  afterAll(() => {
    process.env["NODE_ENV"] = originalNodeEnv;
    if (originalBypass === undefined) delete process.env["DEV_AUTH_BYPASS"];
    else process.env["DEV_AUTH_BYPASS"] = originalBypass;
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

  it("dev-mode resolves user.id from X-Dev-User-Id and lowercases ownerAddress", async () => {
    // Exercise the middleware in isolation (no DB) and capture the AuthUser
    // it sets on the context. In dev-bypass mode, id MUST come from
    // X-Dev-User-Id (the canonical UUID identity), not from the wallet.
    const probe = new Hono();
    probe.use("*", authMiddleware);
    probe.get("/whoami", (c) => {
      const user = c.get("user" as never) as AuthUser;
      return c.json(user);
    });

    const res = await probe.request("/whoami", {
      headers: {
        "X-Dev-Wallet": "0xABCDEF",
        "X-Dev-User-Id": DEV_USER_ID,
      },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as AuthUser;
    expect(body.id).toBe(DEV_USER_ID);
    expect(body.privyUserId).toBe(DEV_USER_ID);
    expect(body.ownerAddress).toBe("0xabcdef");
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
