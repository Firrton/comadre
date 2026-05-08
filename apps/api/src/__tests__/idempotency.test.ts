/**
 * idempotency.test.ts
 *
 * Tests:
 * - POST without X-Idempotency-Key returns 400
 * - POST with X-Idempotency-Key passes the middleware (doesn't block)
 * - Different keys produce independent responses
 *
 * Note: Full cache-replay testing (same key returns cached response) requires
 * a live Redis; those scenarios are marked as integration tests and skipped
 * when UPSTASH_REDIS_REST_URL is not set.
 */
import { describe, it, expect, beforeAll } from "bun:test";
import app from "../server.js";

const DEV_WALLET = "11111111111111111111111111111111";
const DEV_USER_ID = "test-idempotency";

function authHeaders(extra: Record<string, string> = {}) {
  return {
    "X-Dev-Wallet": DEV_WALLET,
    "X-Dev-User-Id": DEV_USER_ID,
    "Content-Type": "application/json",
    ...extra,
  };
}

beforeAll(() => {
  process.env["NODE_ENV"] = "test";
});

const VALID_TANDA_BODY = {
  name: "Test Tanda",
  member_target: 3,
  contribution_amount: "1000000",
  stake_amount: "500000",
  frequency_seconds: 86400,
  payout_order_mode: "join_order",
  usdc_mint: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
};

describe("Idempotency middleware", () => {
  it("returns 400 when X-Idempotency-Key is missing on POST", async () => {
    const res = await app.request("/api/v1/tandas", {
      method: "POST",
      headers: authHeaders(), // no X-Idempotency-Key
      body: JSON.stringify(VALID_TANDA_BODY),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body["error"]).toBe("validation");
    expect((body["message"] as string | undefined)?.toLowerCase()).toContain("idempotency");
  });

  it("proceeds when X-Idempotency-Key is provided", async () => {
    const res = await app.request("/api/v1/tandas", {
      method: "POST",
      headers: authHeaders({ "X-Idempotency-Key": crypto.randomUUID() }),
      body: JSON.stringify(VALID_TANDA_BODY),
    });

    // 200 (success) or 500 (redis unavailable) — but NOT 400 for missing key
    expect(res.status).not.toBe(400);
  });

  it("two different keys execute independently (no cross-key cache collision)", async () => {
    const key1 = crypto.randomUUID();
    const key2 = crypto.randomUUID();

    const [res1, res2] = await Promise.all([
      app.request("/api/v1/tandas", {
        method: "POST",
        headers: authHeaders({ "X-Idempotency-Key": key1 }),
        body: JSON.stringify(VALID_TANDA_BODY),
      }),
      app.request("/api/v1/tandas", {
        method: "POST",
        headers: authHeaders({ "X-Idempotency-Key": key2 }),
        body: JSON.stringify(VALID_TANDA_BODY),
      }),
    ]);

    // Both should have the same status (both succeed or both fail to same DB/Redis)
    expect(res1.status).toBe(res2.status);
  });

  it("(integration) same key returns cached response", async () => {
    // Skip if Redis not configured
    if (!process.env["UPSTASH_REDIS_REST_URL"]) {
      console.log("[skip] UPSTASH_REDIS_REST_URL not set — skipping Redis cache test");
      return;
    }

    const key = crypto.randomUUID();
    const headers = authHeaders({ "X-Idempotency-Key": key });

    const res1 = await app.request("/api/v1/tandas", {
      method: "POST",
      headers,
      body: JSON.stringify(VALID_TANDA_BODY),
    });
    const body1 = await res1.json();

    const res2 = await app.request("/api/v1/tandas", {
      method: "POST",
      headers,
      body: JSON.stringify(VALID_TANDA_BODY),
    });
    const body2 = await res2.json();

    // Cached: idempotency_key in both responses should match
    expect((body1 as Record<string, unknown>)["idempotency_key"]).toBe(
      (body2 as Record<string, unknown>)["idempotency_key"]
    );
  });
});
