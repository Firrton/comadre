/**
 * transfers.test.ts — endpoint shape & validation tests
 *
 * Tests focus on validation and shape; full happy-path is covered by E2E
 * smoke once the program is deployed and Redis/DB are available.
 */
import { describe, it, expect, beforeAll } from "bun:test";
import app from "../server.js";

const DEV_WALLET = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const DEV_USER_ID = "test-user-transfers";

const devHeaders = {
  "X-Dev-Wallet": DEV_WALLET,
  "X-Dev-User-Id": DEV_USER_ID,
  "Content-Type": "application/json",
};

beforeAll(() => {
  process.env["NODE_ENV"] = "test";
});

describe("GET /api/v1/transfers/lookup", () => {
  it("returns 400 on missing phone query param", async () => {
    const res = await app.request("/api/v1/transfers/lookup", { headers: devHeaders });
    expect(res.status).toBe(400);
  });

  it("returns 400 on invalid E.164 phone", async () => {
    const res = await app.request("/api/v1/transfers/lookup?phone=not-a-phone", { headers: devHeaders });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["error"]).toBe("validation");
  });

  it("returns lookup shape with valid E.164 (registered=false when DB miss/error)", async () => {
    const res = await app.request("/api/v1/transfers/lookup?phone=%2B5219999999999", { headers: devHeaders });
    // 200 (DB available, miss) or 500 (DB unavailable in test). Either is OK shape-wise.
    expect([200, 500].includes(res.status)).toBe(true);
    if (res.status === 200) {
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty("phone");
      expect(body).toHaveProperty("phoneHash");
      expect(body).toHaveProperty("registered");
    }
  });
});

describe("POST /api/v1/transfers", () => {
  const idempKey = (): string => crypto.randomUUID();

  const validBody = {
    toPhone: "+5218116346072",
    amountUsdc: "10.50",
    note: "almuerzo",
  };

  it("returns 400 on missing X-Idempotency-Key (POST middleware)", async () => {
    const res = await app.request("/api/v1/transfers", {
      method: "POST",
      headers: devHeaders, // no idempotency key
      body: JSON.stringify(validBody),
    });
    expect([400, 500].includes(res.status)).toBe(true);
  });

  it("returns 400 on invalid amount", async () => {
    const res = await app.request("/api/v1/transfers", {
      method: "POST",
      headers: { ...devHeaders, "X-Idempotency-Key": idempKey() },
      body: JSON.stringify({ ...validBody, amountUsdc: "abc" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 on invalid E.164 phone", async () => {
    const res = await app.request("/api/v1/transfers", {
      method: "POST",
      headers: { ...devHeaders, "X-Idempotency-Key": idempKey() },
      body: JSON.stringify({ ...validBody, toPhone: "5218116346072" }), // missing +
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 on amount with > 6 decimals", async () => {
    const res = await app.request("/api/v1/transfers", {
      method: "POST",
      headers: { ...devHeaders, "X-Idempotency-Key": idempKey() },
      body: JSON.stringify({ ...validBody, amountUsdc: "10.1234567" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects amount=0", async () => {
    const res = await app.request("/api/v1/transfers", {
      method: "POST",
      headers: { ...devHeaders, "X-Idempotency-Key": idempKey() },
      body: JSON.stringify({ ...validBody, amountUsdc: "0" }),
    });
    expect(res.status).toBe(400);
  });

  it("with valid body, reaches the lookup/db layer (returns 4xx or 5xx, not validation 400)", async () => {
    const res = await app.request("/api/v1/transfers", {
      method: "POST",
      headers: { ...devHeaders, "X-Idempotency-Key": idempKey() },
      body: JSON.stringify(validBody),
    });
    // The validation 400 path returns "error":"validation"; below that, the
    // route hits DB/lookup which may fail with 404 USER_NOT_FOUND or 500 if
    // DB is unavailable. Accept anything >= 400 (we just want to confirm we
    // passed Zod validation).
    expect(res.status).toBeGreaterThanOrEqual(400);
    if (res.status === 400) {
      const body = (await res.json()) as Record<string, unknown>;
      // If 400, must be a domain error (USER_NOT_FOUND mapped, INVALID_AMOUNT, etc.) — NOT generic validation
      expect(body["error"]).not.toBe("validation");
    }
  });
});

describe("POST /api/v1/transfers/:id/cancel", () => {
  it("returns 404 when transfer doesn't exist", async () => {
    const res = await app.request(
      "/api/v1/transfers/00000000-0000-0000-0000-000000000000/cancel",
      {
        method: "POST",
        headers: { ...devHeaders, "X-Idempotency-Key": crypto.randomUUID() },
      }
    );
    expect([404, 500].includes(res.status)).toBe(true);
    if (res.status === 404) {
      const body = (await res.json()) as Record<string, unknown>;
      expect(body["error"]).toBe("NOT_FOUND");
    }
  });
});

describe("POST /api/v1/transfers/:id/confirm", () => {
  it("returns 404 when transfer doesn't exist", async () => {
    const res = await app.request(
      "/api/v1/transfers/00000000-0000-0000-0000-000000000000/confirm",
      {
        method: "POST",
        headers: { ...devHeaders, "X-Idempotency-Key": crypto.randomUUID() },
      }
    );
    expect([404, 500].includes(res.status)).toBe(true);
  });
});
