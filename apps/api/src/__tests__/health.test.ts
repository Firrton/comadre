/**
 * health.test.ts — smoke test for GET /health
 */
import { describe, it, expect } from "bun:test";
import app from "../server.js";

describe("GET /health", () => {
  it("returns 200 with correct shape", async () => {
    const res = await app.request("/health");

    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, unknown>;
    expect(body["status"]).toBe("ok");
    expect(body["service"]).toBe("api");
    expect(typeof body["timestamp"]).toBe("string");
  });

  it("does not require Authorization header", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
  });
});
