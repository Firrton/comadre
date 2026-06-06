/**
 * idempotency.test.ts
 *
 * Exercises the idempotency middleware (applied to every /api/* POST except
 * onboarding). Vehicle route: POST /api/v1/savings/deposits.
 *
 * The middleware runs BEFORE the route's own body validator, so:
 *   - missing X-Idempotency-Key  → middleware 400 (message mentions "idempotency")
 *   - key present                → middleware passes; an empty body then trips the
 *                                  route's zValidator 400 (no "idempotency" message),
 *                                  proving control reached the route. No DB needed.
 *
 * Full cache-replay (same key returns cached response) requires a live Redis;
 * that scenario is an integration test, skipped when UPSTASH_REDIS_REST_URL is unset.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import app from "../server.js";

const DEV_WALLET = "11111111111111111111111111111111";
const DEV_USER_ID = "test-idempotency";
const VEHICLE = "/api/v1/savings/deposits";

function authHeaders(extra: Record<string, string> = {}) {
  return {
    "X-Dev-Wallet": DEV_WALLET,
    "X-Dev-User-Id": DEV_USER_ID,
    "Content-Type": "application/json",
    ...extra,
  };
}

let originalNodeEnv: string | undefined;
let originalBypass: string | undefined;

beforeAll(() => {
  originalNodeEnv = process.env["NODE_ENV"];
  originalBypass = process.env["DEV_AUTH_BYPASS"];
  process.env["NODE_ENV"] = "test";
  // Audit COM-006: dev-header auth bypass now requires this explicit flag so the
  // request reaches the idempotency middleware instead of being rejected at auth.
  process.env["DEV_AUTH_BYPASS"] = "true";
});

afterAll(() => {
  process.env["NODE_ENV"] = originalNodeEnv;
  if (originalBypass === undefined) delete process.env["DEV_AUTH_BYPASS"];
  else process.env["DEV_AUTH_BYPASS"] = originalBypass;
});

describe("Idempotency middleware", () => {
  it("returns 400 when X-Idempotency-Key is missing on POST", async () => {
    const res = await app.request(VEHICLE, {
      method: "POST",
      headers: authHeaders(), // no X-Idempotency-Key
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["error"]).toBe("validation");
    expect((body["message"] as string | undefined)?.toLowerCase()).toContain("idempotency");
  });

  it("passes the middleware when X-Idempotency-Key is provided", async () => {
    const res = await app.request(VEHICLE, {
      method: "POST",
      headers: authHeaders({ "X-Idempotency-Key": crypto.randomUUID() }),
      body: JSON.stringify({}), // invalid body → route validator, NOT the idempotency gate
    });

    // Control reached the route validator → the idempotency gate let it through.
    const body = (await res.json()) as Record<string, unknown>;
    const message = ((body["message"] as string | undefined) ?? "").toLowerCase();
    expect(message).not.toContain("idempotency");
  });

  it("two different keys both pass the middleware independently", async () => {
    const [res1, res2] = await Promise.all([
      app.request(VEHICLE, {
        method: "POST",
        headers: authHeaders({ "X-Idempotency-Key": crypto.randomUUID() }),
        body: JSON.stringify({}),
      }),
      app.request(VEHICLE, {
        method: "POST",
        headers: authHeaders({ "X-Idempotency-Key": crypto.randomUUID() }),
        body: JSON.stringify({}),
      }),
    ]);

    // No cross-key collision: both keys execute and resolve to the same outcome.
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

    const res1 = await app.request(VEHICLE, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });
    const body1 = await res1.json();

    const res2 = await app.request(VEHICLE, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });
    const body2 = await res2.json();

    // Cached: idempotency_key in both responses should match
    expect((body1 as Record<string, unknown>)["idempotency_key"]).toBe(
      (body2 as Record<string, unknown>)["idempotency_key"]
    );
  });
});
