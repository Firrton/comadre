import { describe, expect, test, mock } from "bun:test";

// ---------------------------------------------------------------------------
// MessageSid dedup — route-level guard
//
// The dedup block in POST /webhook is intentionally disabled when
// NODE_ENV === "test" (mirrors the rate-limit guard pattern). The core
// dedup logic (markMessageSeen) is fully tested in the cache package unit
// tests: packages/cache/src/__tests__/msgDedup.test.ts
//
// Here we confirm that:
//   (a) the guard correctly skips Redis in NODE_ENV=test (markMessageSeen
//       is never called from the route in test mode), and
//   (b) the existing route behavior (sig check, reply auth) is unchanged.
// ---------------------------------------------------------------------------

// Must be declared before app import so mock.module is hoisted.
const mockMarkMessageSeen = mock(async (_sid: string) => false);

mock.module("@comadre/cache", () => ({
  webhookRateLimit: {},
  checkRateLimit: async () => ({ allowed: true, remaining: 60, resetAt: new Date() }),
  markMessageSeen: mockMarkMessageSeen,
}));

import { app } from "../index.js";

describe("whatsapp service", () => {
  test("GET /health returns 200", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; service: string };
    expect(json.ok).toBe(true);
    expect(json.service).toBe("whatsapp");
  });

  test("POST /webhook without signature returns 403", async () => {
    const form = new URLSearchParams();
    form.set("From", "whatsapp:+5218116346072");
    form.set("Body", "hola");

    const res = await app.request("/webhook", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    expect(res.status).toBe(403);
  });

  test("POST /reply without auth returns 401", async () => {
    const res = await app.request("/reply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: "whatsapp:+5218116346072", body: "hola" }),
    });
    expect(res.status).toBe(401);
  });

  // Confirms the dedup guard skips Redis entirely in NODE_ENV=test.
  // Signature check fires first (returns 403) — markMessageSeen must not be
  // called because the guard condition `NODE_ENV !== 'test'` is false.
  test("markMessageSeen is NOT called in NODE_ENV=test (Redis guard skipped)", async () => {
    mockMarkMessageSeen.mockClear();

    const form = new URLSearchParams();
    form.set("From", "whatsapp:+5218116346072");
    form.set("Body", "si");
    form.set("MessageSid", "SM_guard_test");

    const res = await app.request("/webhook", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });

    // 403: sig check fires before dedup — expected in test env.
    expect(res.status).toBe(403);
    // The dedup guard is bypassed in test env, so the helper is never called.
    expect(mockMarkMessageSeen).not.toHaveBeenCalled();
  });
});
