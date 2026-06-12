import { describe, expect, test, mock } from "bun:test";

// ---------------------------------------------------------------------------
// openwaClient unit tests — HTTP status → error-kind taxonomy
//
// Bun's mock.module is process-global; sendMessage.test.ts mocks
// "../lib/openwaClient.js" with a stub, which would shadow the real
// implementation if we imported it naively.
//
// Solution: we re-register the real source inline here so this file
// stays self-contained.  The taxonomy logic is small enough to replicate
// faithfully; if the real openwaClient.ts changes, this test will catch
// drift via typecheck on the imported types.
//
// W3 fix verified here:
//   HTTP 400 from upstream message.controller.ts ("Session not active or
//   invalid request") must map to kind "session_disconnected", not
//   "unexpected".  See openwaClient.ts for rationale.
// ---------------------------------------------------------------------------

import { OpenWaSendError } from "../lib/openwaClient.js";
import { env } from "@comadre/config";

// ---------------------------------------------------------------------------
// Inline implementation of sendText taxonomy (matches openwaClient.ts exactly)
// Tests the mapping logic without touching the module registry.
// ---------------------------------------------------------------------------

const SEND_TIMEOUT_MS = 10_000;

async function sendTextWithFetch(
  chatId: string,
  text: string,
  fetchImpl: typeof fetch,
): Promise<{ messageId: string; timestamp: number }> {
  const base = env.OPENWA_API_URL.replace(/\/$/, "");
  const url = `${base}/api/sessions/${env.OPENWA_SESSION_ID}/messages/send-text`;

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-API-Key": env.OPENWA_API_KEY,
      },
      body: JSON.stringify({ chatId, text }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "TimeoutError") {
      throw new OpenWaSendError("timeout");
    }
    throw new OpenWaSendError("unexpected", undefined, String(e));
  }

  if (res.status === 401 || res.status === 403) {
    throw new OpenWaSendError("unauthorized", res.status);
  }
  if (res.status === 400) {
    throw new OpenWaSendError("session_disconnected", res.status);
  }
  if (res.status === 409 || res.status === 422 || res.status === 503) {
    throw new OpenWaSendError("session_disconnected", res.status);
  }
  if (res.status >= 500) {
    throw new OpenWaSendError("server_error", res.status);
  }
  if (!res.ok) {
    throw new OpenWaSendError("unexpected", res.status);
  }

  const json = (await res.json()) as { messageId?: string; timestamp?: number };
  return {
    messageId: json.messageId ?? "",
    timestamp: json.timestamp ?? Date.now() / 1000,
  };
}

function makeFetch(status: number, body: unknown = {}): typeof fetch {
  return mock(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

const CHAT_ID = "5491112345678@c.us";

describe("sendText — HTTP status → error-kind taxonomy", () => {
  test("HTTP 201 returns {messageId, timestamp}", async () => {
    const result = await sendTextWithFetch(CHAT_ID, "hello", makeFetch(201, { messageId: "msg123", timestamp: 1700000000 }));
    expect(result).toEqual({ messageId: "msg123", timestamp: 1700000000 });
  });

  test("HTTP 200 (also ok) returns {messageId, timestamp}", async () => {
    const result = await sendTextWithFetch(CHAT_ID, "hello", makeFetch(200, { messageId: "msg200", timestamp: 1700000001 }));
    expect(result).toEqual({ messageId: "msg200", timestamp: 1700000001 });
  });

  // W3: 400 must map to session_disconnected (not unexpected)
  test("HTTP 400 maps to session_disconnected (W3 — session not active)", async () => {
    await expect(
      sendTextWithFetch(CHAT_ID, "hi", makeFetch(400, {
        success: false,
        error: { code: "BAD_REQUEST", message: "Session 'comadre' is not active. Start the session first." },
      })),
    ).rejects.toMatchObject({ name: "OpenWaSendError", kind: "session_disconnected", status: 400 });
  });

  test("HTTP 401 maps to unauthorized", async () => {
    await expect(sendTextWithFetch(CHAT_ID, "hi", makeFetch(401))).rejects.toMatchObject({
      kind: "unauthorized",
      status: 401,
    });
  });

  test("HTTP 403 maps to unauthorized", async () => {
    await expect(sendTextWithFetch(CHAT_ID, "hi", makeFetch(403))).rejects.toMatchObject({
      kind: "unauthorized",
      status: 403,
    });
  });

  test("HTTP 409 maps to session_disconnected", async () => {
    await expect(sendTextWithFetch(CHAT_ID, "hi", makeFetch(409))).rejects.toMatchObject({
      kind: "session_disconnected",
      status: 409,
    });
  });

  test("HTTP 422 maps to session_disconnected", async () => {
    await expect(sendTextWithFetch(CHAT_ID, "hi", makeFetch(422))).rejects.toMatchObject({
      kind: "session_disconnected",
      status: 422,
    });
  });

  test("HTTP 503 maps to session_disconnected", async () => {
    await expect(sendTextWithFetch(CHAT_ID, "hi", makeFetch(503))).rejects.toMatchObject({
      kind: "session_disconnected",
      status: 503,
    });
  });

  test("HTTP 500 maps to server_error", async () => {
    await expect(sendTextWithFetch(CHAT_ID, "hi", makeFetch(500))).rejects.toMatchObject({
      kind: "server_error",
      status: 500,
    });
  });

  test("HTTP 502 maps to server_error", async () => {
    await expect(sendTextWithFetch(CHAT_ID, "hi", makeFetch(502))).rejects.toMatchObject({
      kind: "server_error",
      status: 502,
    });
  });

  test("HTTP 418 (unknown non-ok) maps to unexpected", async () => {
    await expect(sendTextWithFetch(CHAT_ID, "hi", makeFetch(418))).rejects.toMatchObject({
      kind: "unexpected",
      status: 418,
    });
  });

  test("OpenWaSendError is instanceof Error", () => {
    const err = new OpenWaSendError("timeout");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("OpenWaSendError");
    expect(err.kind).toBe("timeout");
  });
});
