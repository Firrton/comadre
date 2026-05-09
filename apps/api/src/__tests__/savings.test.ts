import { describe, expect, it, beforeAll } from "bun:test";
import app from "../server.js";

const DEV_WALLET = "11111111111111111111111111111111";
const DEV_USER_ID = "test-guardadito";

beforeAll(() => {
  process.env["NODE_ENV"] = "test";
});

describe("GET /api/v1/savings/summary", () => {
  it("returns Guardadito summary with mocked balance", async () => {
    const res = await app.request("/api/v1/savings/summary", {
      headers: {
        "X-Dev-Wallet": DEV_WALLET,
        "X-Dev-User-Id": DEV_USER_ID,
        "X-Mock-USDC-Balance": "50000000",
      },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["provider"]).toBe("mock");
    expect(body["available"]).toEqual({ usdc: "50", microUsdc: "50000000" });
  });
});
