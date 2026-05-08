import { describe, it, expect, beforeEach } from "bun:test";

describe("cache smoke", () => {
  beforeEach(() => {
    // Reset the module-level singleton so each test starts clean.
    // We do this by deleting the env vars before dynamic imports.
    delete process.env["UPSTASH_REDIS_REST_URL"];
    delete process.env["UPSTASH_REDIS_REST_TOKEN"];
  });

  it("getRedis() does not throw without env vars", async () => {
    // Dynamic import bypasses module-level singleton caching across tests.
    const { getRedis } = await import("../client.js");
    expect(() => getRedis()).not.toThrow();
  });

  it("hashPhone is deterministic 64-char hex", async () => {
    const { hashPhone } = await import("../waWindow.js");
    const a = await hashPhone("+5491112345678");
    const b = await hashPhone("+5491112345678");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashPhone rejects invalid E.164", async () => {
    const { hashPhone } = await import("../waWindow.js");
    await expect(hashPhone("5491112345678")).rejects.toThrow(/E\.164/);
    await expect(hashPhone("not a phone")).rejects.toThrow();
    await expect(hashPhone("")).rejects.toThrow();
  });
});
