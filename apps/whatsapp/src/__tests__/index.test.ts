import { describe, expect, test, mock } from "bun:test";

// ---------------------------------------------------------------------------
// OpenWA inbound route tests
//
// The dedup and rate-limit blocks in POST /webhooks/whatsapp are intentionally
// disabled when NODE_ENV === "test" (mirrors the Twilio-era pattern).
// The core dedup logic is fully tested in packages/cache/src/__tests__/msgDedup.test.ts.
// Signature verification is fully tested in __tests__/openwaInbound.test.ts.
//
// Here we verify:
//   (a) filter pipeline drop cases (fromMe, isGroup, non-text, bad JID, event type)
//   (b) valid message forwarded to agent → 200 {ok:true}
//   (c) markMessageSeen is NOT called in test mode (Redis guard)
//   (d) /reply HMAC auth (unchanged from Twilio era)
//   (e) /health baseline
// ---------------------------------------------------------------------------

// Must be declared before app import so mock.module is hoisted.
const mockMarkMessageSeen = mock(async (_id: string) => false);

// Stateful nonce store so the replay-detection test can observe the second call returning false.
const seenNonces = new Set<string>();
const mockMarkNonceSeen = mock(async (sig: string, _ttl: number): Promise<boolean> => {
  if (seenNonces.has(sig)) return false;
  seenNonces.add(sig);
  return true;
});

mock.module("@comadre/cache", () => ({
  webhookRateLimit: {},
  checkRateLimit: async () => ({ allowed: true, remaining: 60, resetAt: new Date() }),
  markMessageSeen: mockMarkMessageSeen,
  markNonceSeen: mockMarkNonceSeen,
}));

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

/** Build a minimal valid OpenWA JSON payload for POST /webhooks/whatsapp.
 *
 * `dataOverrides` are merged INTO the default data object (preserving id/from).
 * `topOverrides` are merged at the envelope level (event, sessionId, etc.).
 */
function makeWebhookBody(
  dataOverrides: Record<string, unknown> = {},
  topOverrides: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    event: "message.received",
    sessionId: "comadre",
    ...topOverrides,
    data: {
      id: "true_5491112345678@c.us_3EB0test001",
      from: "5491112345678@c.us",
      body: "hola",
      type: "chat",
      fromMe: false,
      isGroup: false,
      ...dataOverrides,
    },
  });
}

describe("whatsapp service", () => {
  test("GET /health returns 200", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; service: string };
    expect(json.ok).toBe(true);
    expect(json.service).toBe("whatsapp");
  });

  // -------------------------------------------------------------------------
  // POST /webhooks/whatsapp — OpenWA inbound
  // In NODE_ENV=test: signature check is bypassed, Redis ops are skipped.
  // -------------------------------------------------------------------------

  test("POST /webhooks/whatsapp with valid JSON returns 200 {ok:true}", async () => {
    const body = makeWebhookBody();
    const res = await app.request("/webhooks/whatsapp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-OpenWA-Event": "message.received",
      },
      body,
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(true);
  });

  test("POST /webhooks/whatsapp with data.fromMe:true returns 200 and drops (R1.S4)", async () => {
    const body = makeWebhookBody({ fromMe: true });
    const res = await app.request("/webhooks/whatsapp", {
      method: "POST",
      headers: { "content-type": "application/json", "X-OpenWA-Event": "message.received" },
      body,
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ignored?: string };
    expect(json.ignored).toBe("fromMe");
  });

  test("POST /webhooks/whatsapp with data.isGroup:true returns 200 and drops (R1.S5)", async () => {
    const body = makeWebhookBody({ isGroup: true });
    const res = await app.request("/webhooks/whatsapp", {
      method: "POST",
      headers: { "content-type": "application/json", "X-OpenWA-Event": "message.received" },
      body,
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ignored?: string };
    expect(json.ignored).toBe("group");
  });

  test("POST /webhooks/whatsapp with data.type:image + empty body returns 200 non-text drop (R1.S6)", async () => {
    const body = makeWebhookBody({ type: "image", body: "" });
    const res = await app.request("/webhooks/whatsapp", {
      method: "POST",
      headers: { "content-type": "application/json", "X-OpenWA-Event": "message.received" },
      body,
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ignored?: string };
    expect(json.ignored).toBe("non-text");
  });

  test("POST /webhooks/whatsapp with non-message event returns 200 ignored (R1.S7)", async () => {
    const body = makeWebhookBody({}, { event: "session.status" });
    const res = await app.request("/webhooks/whatsapp", {
      method: "POST",
      headers: { "content-type": "application/json", "X-OpenWA-Event": "session.status" },
      body,
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ignored?: string };
    expect(json.ignored).toBe("event");
  });

  test("POST /webhooks/whatsapp with malformed JID returns 200 badjid drop (R1.S8)", async () => {
    const body = makeWebhookBody({ from: "notajid" });
    const res = await app.request("/webhooks/whatsapp", {
      method: "POST",
      headers: { "content-type": "application/json", "X-OpenWA-Event": "message.received" },
      body,
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ignored?: string };
    expect(json.ignored).toBe("badjid");
  });

  test("POST /webhooks/whatsapp with invalid JSON returns 400", async () => {
    const res = await app.request("/webhooks/whatsapp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json {",
    });
    expect(res.status).toBe(400);
  });

  // Confirms the dedup guard skips Redis entirely in NODE_ENV=test.
  // In test mode the signature check is also bypassed, so markMessageSeen
  // must not be called because the NODE_ENV guard fires first.
  test("markMessageSeen is NOT called in NODE_ENV=test (Redis guard skipped)", async () => {
    mockMarkMessageSeen.mockClear();

    const body = makeWebhookBody();
    await app.request("/webhooks/whatsapp", {
      method: "POST",
      headers: { "content-type": "application/json", "X-OpenWA-Event": "message.received" },
      body,
    });

    // The dedup guard is bypassed in test env — helper must not be called.
    expect(mockMarkMessageSeen).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // POST /reply — HMAC-authed outbound (unchanged from Twilio era)
  // -------------------------------------------------------------------------

  test("POST /reply without auth returns 401", async () => {
    const res = await app.request("/reply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: "whatsapp:+5218116346072", body: "hola" }),
    });
    expect(res.status).toBe(401);
  });

  test("POST /reply with valid timestamped signature passes auth check", async () => {
    const payload = JSON.stringify({ to: "whatsapp:+5218116346072", body: "hola" });
    const res = await app.request("/reply", {
      method: "POST",
      headers: makeReplyHeaders(payload),
      body: payload,
    });
    // Auth passes; outbound send may fail (no real OpenWA) → 502 not 401/400
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  test("POST /reply with stale timestamp returns 401", async () => {
    const payload = JSON.stringify({ to: "whatsapp:+5218116346072", body: "hola" });
    const staleTimestamp = String(Date.now() - 400_000); // 400s ago
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
    const payload = JSON.stringify({ to: "whatsapp:+5218116346072", body: "replay-test-openwa" });
    const timestamp = String(Date.now());
    const signature = signReplyRequest(SECRET, timestamp, payload);
    const headers = {
      "content-type": "application/json",
      "X-Internal-Signature": signature,
      "X-Internal-Timestamp": timestamp,
    };

    // First request — auth passes (outbound may fail → non-401)
    const first = await app.request("/reply", { method: "POST", headers, body: payload });
    expect(first.status).not.toBe(401);

    // Second request with identical signature — replay rejected
    const second = await app.request("/reply", { method: "POST", headers, body: payload });
    expect(second.status).toBe(401);
    const json = (await second.json()) as { error: string };
    expect(json.error).toBe("replayed request");
  });
});
