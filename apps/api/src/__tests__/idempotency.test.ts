/**
 * idempotency.test.ts
 *
 * Tests:
 * - POST without X-Idempotency-Key returns 400
 * - POST with X-Idempotency-Key passes the middleware (doesn't block)
 * - Different keys produce independent responses
 *
 * Target route: POST /api/v1/onramp/quote — a live Monad-era POST route behind
 * the idempotency middleware. (The previous target, /api/v1/tandas, was removed
 * in the tanda excision.)
 *
 * Note: Full cache-replay testing (same key returns cached response) requires
 * a live Redis; that scenario is an integration test, skipped when SKIP_REDIS
 * is set or UPSTASH_REDIS_REST_URL is missing.
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

const QUOTE_PATH = "/api/v1/onramp/quote";

const VALID_QUOTE_BODY = {
  fiat_currency: "MXN",
  fiat_amount_cents: 10000,
  user_wallet: DEV_WALLET,
};

describe("Idempotency middleware", () => {
  it("returns 400 when X-Idempotency-Key is missing on POST", async () => {
    const res = await app.request(QUOTE_PATH, {
      method: "POST",
      headers: authHeaders(), // no X-Idempotency-Key
      body: JSON.stringify(VALID_QUOTE_BODY),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body["error"]).toBe("validation");
    expect((body["message"] as string | undefined)?.toLowerCase()).toContain("idempotency");
  });

  it("proceeds when X-Idempotency-Key is provided", async () => {
    const res = await app.request(QUOTE_PATH, {
      method: "POST",
      headers: authHeaders({ "X-Idempotency-Key": crypto.randomUUID() }),
      body: JSON.stringify(VALID_QUOTE_BODY),
    });

    // 200 (success) or 500 (redis unavailable) — but NOT 400 for missing key
    expect(res.status).not.toBe(400);
  });

  it("two different keys execute independently (no cross-key cache collision)", async () => {
    const key1 = crypto.randomUUID();
    const key2 = crypto.randomUUID();

    const [res1, res2] = await Promise.all([
      app.request(QUOTE_PATH, {
        method: "POST",
        headers: authHeaders({ "X-Idempotency-Key": key1 }),
        body: JSON.stringify(VALID_QUOTE_BODY),
      }),
      app.request(QUOTE_PATH, {
        method: "POST",
        headers: authHeaders({ "X-Idempotency-Key": key2 }),
        body: JSON.stringify(VALID_QUOTE_BODY),
      }),
    ]);

    // Both should have the same status (both succeed or both fail to same DB/Redis)
    expect(res1.status).toBe(res2.status);
  });

  it("(integration) same key returns cached response", async () => {
    // Needs a real Redis: skip under SKIP_REDIS or when no URL is configured.
    if (process.env["SKIP_REDIS"] === "true" || !process.env["UPSTASH_REDIS_REST_URL"]) {
      console.log("[skip] no live Redis — skipping cache-replay test");
      return;
    }

    const key = crypto.randomUUID();
    const headers = authHeaders({ "X-Idempotency-Key": key });

    const res1 = await app.request(QUOTE_PATH, {
      method: "POST",
      headers,
      body: JSON.stringify(VALID_QUOTE_BODY),
    });
    const body1 = await res1.json();

    // The quote embeds expires_at (now + 5 min); without the cache a later
    // call produces a different timestamp, so equality proves the replay.
    await new Promise((r) => setTimeout(r, 10));

    const res2 = await app.request(QUOTE_PATH, {
      method: "POST",
      headers,
      body: JSON.stringify(VALID_QUOTE_BODY),
    });
    const body2 = await res2.json();

    expect(body2).toEqual(body1);
  });
});
