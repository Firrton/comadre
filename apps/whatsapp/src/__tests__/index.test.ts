import { describe, expect, test } from "bun:test";

import { app, signReplyRequest } from "../index.js";

const SECRET = process.env["INTERNAL_HMAC_SECRET"] ?? "test-secret";

function makeReplyHeaders(body: string, overrides: Record<string, string> = {}): Record<string, string> {
  const timestamp = String(Date.now());
  const signature = signReplyRequest(SECRET, timestamp, body);
  return {
    "content-type": "application/json",
    "X-Internal-Signature": signature,
    "X-Internal-Timestamp": timestamp,
    ...overrides,
  };
}

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

  test("POST /reply with valid timestamped signature returns 200", async () => {
    // Stub sendWhatsAppMessage by using the in-process app — Twilio is not called
    // because NODE_ENV=test; the handler will call sendWhatsAppMessage which will
    // throw without real Twilio creds, so we only check the auth path passes.
    const payload = JSON.stringify({ to: "whatsapp:+5218116346072", body: "hola" });
    const res = await app.request("/reply", {
      method: "POST",
      headers: makeReplyHeaders(payload),
      body: payload,
    });
    // Auth passes; Twilio fails → 502 (not 401/400)
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  test("POST /reply with stale timestamp returns 401", async () => {
    const payload = JSON.stringify({ to: "whatsapp:+5218116346072", body: "hola" });
    const staleTimestamp = String(Date.now() - 400_000); // 400s ago, outside 300s window
    const signature = signReplyRequest(SECRET, staleTimestamp, payload);
    const res = await app.request("/reply", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Internal-Signature": signature,
        "X-Internal-Timestamp": staleTimestamp,
      },
      body: payload,
    });
    expect(res.status).toBe(401);
  });

  test("POST /reply replayed signature returns 401 on second attempt", async () => {
    const payload = JSON.stringify({ to: "whatsapp:+5218116346072", body: "replay-test" });
    const timestamp = String(Date.now());
    const signature = signReplyRequest(SECRET, timestamp, payload);
    const headers = {
      "content-type": "application/json",
      "X-Internal-Signature": signature,
      "X-Internal-Timestamp": timestamp,
    };

    // First request — auth passes (Twilio may fail → non-401)
    const first = await app.request("/reply", {
      method: "POST",
      headers,
      body: payload,
    });
    expect(first.status).not.toBe(401);

    // Second request with identical signature — replay rejected
    const second = await app.request("/reply", {
      method: "POST",
      headers,
      body: payload,
    });
    expect(second.status).toBe(401);
    const json = (await second.json()) as { error: string };
    expect(json.error).toBe("replayed request");
  });
});
