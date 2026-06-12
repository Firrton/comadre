import { describe, expect, test, mock, afterEach } from "bun:test";

// ---------------------------------------------------------------------------
// openwaBootstrap unit tests
//
// All HTTP calls are intercepted via global.fetch mock so no real network hits.
// Tests verify:
//   (a) Webhook already exists → no POST /webhooks (idempotent)
//   (b) Webhook missing → POST /webhooks is called
//   (c) Health unreachable → no throw, exits gracefully, no session calls
//   (d) Unknown session status → no throw, continues
//   (e) Session not found (404) → creates then starts
//   (f) qr_ready status → QR endpoint is called, no throw
//
// Because global.fetch is replaced per-test, we use afterEach to restore.
// ---------------------------------------------------------------------------

const apiUrl = "http://localhost:3005"; // from apps/whatsapp/.env.test
const sessionId = "test";              // from apps/whatsapp/.env.test
const webhookTargetUrl = "http://host.docker.internal:3002/webhooks/whatsapp";

function makeJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Extract the string URL from whatever fetch receives as first argument. */
function inputToUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

// Save original fetch so we can restore it.
const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

import { bootstrapOpenWa } from "../lib/openwaBootstrap.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("bootstrapOpenWa", () => {
  test("webhook already exists → no POST /webhooks (idempotent)", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    global.fetch = mock(
      async (input: string | URL | Request, options?: RequestInit): Promise<Response> => {
        const url = inputToUrl(input);
        const method = options?.method ?? "GET";
        calls.push({ url, method });

        if (url.endsWith("/api/health")) return makeJson({ status: "ok" });
        if (url === `${apiUrl}/api/sessions/${sessionId}`) {
          return makeJson({ status: "ready" });
        }
        if (url === `${apiUrl}/api/sessions/${sessionId}/webhooks` && method === "GET") {
          return makeJson([{ url: webhookTargetUrl, events: ["message.received"] }]);
        }
        return new Response("not found", { status: 404 });
      },
    ) as unknown as typeof fetch;

    await bootstrapOpenWa();

    const webhookPosts = calls.filter(
      (c) => c.url.includes("/webhooks") && c.method === "POST",
    );
    expect(webhookPosts).toHaveLength(0);
  });

  test("webhook missing → POST /webhooks is called once", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    global.fetch = mock(
      async (input: string | URL | Request, options?: RequestInit): Promise<Response> => {
        const url = inputToUrl(input);
        const method = options?.method ?? "GET";
        calls.push({ url, method });

        if (url.endsWith("/api/health")) return makeJson({ status: "ok" });
        if (url === `${apiUrl}/api/sessions/${sessionId}` && method === "GET") {
          return makeJson({ status: "ready" });
        }
        if (url === `${apiUrl}/api/sessions/${sessionId}/webhooks` && method === "GET") {
          // Return empty list — no existing webhook
          return makeJson([]);
        }
        if (url === `${apiUrl}/api/sessions/${sessionId}/webhooks` && method === "POST") {
          return makeJson({ ok: true }, 201);
        }
        return new Response("not found", { status: 404 });
      },
    ) as unknown as typeof fetch;

    await bootstrapOpenWa();

    const webhookPosts = calls.filter(
      (c) => c.url.includes("/webhooks") && c.method === "POST",
    );
    expect(webhookPosts).toHaveLength(1);
  });

  test("health unreachable → no throw, exits gracefully (no further calls)", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    global.fetch = mock(
      async (input: string | URL | Request, options?: RequestInit): Promise<Response> => {
        const url = inputToUrl(input);
        const method = options?.method ?? "GET";
        calls.push({ url, method });

        // Health always fails
        if (url.endsWith("/api/health")) return new Response("", { status: 503 });
        return new Response("not found", { status: 404 });
      },
    ) as unknown as typeof fetch;

    // Must NOT throw
    await expect(bootstrapOpenWa()).resolves.toBeUndefined();

    // After health fail, no session or webhook calls
    const postHealthCalls = calls.filter((c) => !c.url.endsWith("/api/health"));
    expect(postHealthCalls).toHaveLength(0);
  });

  test("unknown session status → no throw, continues to webhook step", async () => {
    global.fetch = mock(
      async (input: string | URL | Request, options?: RequestInit): Promise<Response> => {
        const url = inputToUrl(input);
        const method = options?.method ?? "GET";

        if (url.endsWith("/api/health")) return makeJson({ status: "ok" });
        if (url === `${apiUrl}/api/sessions/${sessionId}` && method === "GET") {
          return makeJson({ status: "some_future_state_we_dont_know" });
        }
        if (url === `${apiUrl}/api/sessions/${sessionId}/webhooks` && method === "GET") {
          return makeJson([{ url: webhookTargetUrl, events: ["message.received"] }]);
        }
        return new Response("not found", { status: 404 });
      },
    ) as unknown as typeof fetch;

    // Must NOT throw despite unknown status
    await expect(bootstrapOpenWa()).resolves.toBeUndefined();
  });

  test("session not found (404) → creates then starts", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    let getSessionCount = 0;
    global.fetch = mock(
      async (input: string | URL | Request, options?: RequestInit): Promise<Response> => {
        const url = inputToUrl(input);
        const method = options?.method ?? "GET";
        calls.push({ url, method });

        if (url.endsWith("/api/health")) return makeJson({ status: "ok" });

        if (url === `${apiUrl}/api/sessions/${sessionId}` && method === "GET") {
          getSessionCount++;
          // First call: not found; subsequent calls: initializing
          if (getSessionCount === 1) return new Response("not found", { status: 404 });
          return makeJson({ status: "initializing" });
        }
        if (url === `${apiUrl}/api/sessions` && method === "POST") {
          return makeJson({ ok: true }, 201);
        }
        if (url === `${apiUrl}/api/sessions/${sessionId}/start` && method === "POST") {
          return makeJson({ ok: true });
        }
        if (url === `${apiUrl}/api/sessions/${sessionId}/webhooks` && method === "GET") {
          return makeJson([{ url: webhookTargetUrl, events: ["message.received"] }]);
        }
        return new Response("not found", { status: 404 });
      },
    ) as unknown as typeof fetch;

    await bootstrapOpenWa();

    const createCalls = calls.filter(
      (c) => c.url === `${apiUrl}/api/sessions` && c.method === "POST",
    );
    const startCalls = calls.filter(
      (c) => c.url.includes("/start") && c.method === "POST",
    );
    expect(createCalls).toHaveLength(1);
    expect(startCalls).toHaveLength(1);
  });

  test("qr_ready status → QR endpoint is called (no throw)", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    global.fetch = mock(
      async (input: string | URL | Request, options?: RequestInit): Promise<Response> => {
        const url = inputToUrl(input);
        const method = options?.method ?? "GET";
        calls.push({ url, method });

        if (url.endsWith("/api/health")) return makeJson({ status: "ok" });
        if (url === `${apiUrl}/api/sessions/${sessionId}` && method === "GET") {
          return makeJson({ status: "qr_ready" });
        }
        if (url === `${apiUrl}/api/sessions/${sessionId}/qr` && method === "GET") {
          return makeJson({ qrCode: "data:image/png;base64,abc123" });
        }
        if (url === `${apiUrl}/api/sessions/${sessionId}/webhooks` && method === "GET") {
          return makeJson([{ url: webhookTargetUrl, events: ["message.received"] }]);
        }
        return new Response("not found", { status: 404 });
      },
    ) as unknown as typeof fetch;

    // Must NOT throw
    await expect(bootstrapOpenWa()).resolves.toBeUndefined();

    const qrCalls = calls.filter((c) => c.url.includes("/qr"));
    expect(qrCalls).toHaveLength(1);
  });
});
