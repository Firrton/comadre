import { createHmac } from "node:crypto";
import { afterEach, describe, expect, mock, test } from "bun:test";

import { app, processDeps } from "../index.js";

const SECRET = process.env["INTERNAL_HMAC_SECRET"] ?? "test-secret";

function makeProcessHeaders(body: string, overrides: Record<string, string> = {}): Record<string, string> {
  const timestamp = String(Date.now());
  const signature = createHmac("sha256", SECRET)
    .update(`POST\n/process\n${timestamp}\n${body}`)
    .digest("hex");
  return {
    "content-type": "application/json",
    "X-Internal-Signature": signature,
    "X-Internal-Timestamp": timestamp,
    ...overrides,
  };
}

const originalRunAgent = processDeps.runAgent;
const originalResolveTransferConfirmation = processDeps.resolveTransferConfirmation;
const originalResolveUserFromPhone = processDeps.resolveUserFromPhone;
const originalLoadHistory = processDeps.loadHistory;
const originalSaveHistory = processDeps.saveHistory;

afterEach(() => {
  processDeps.runAgent = originalRunAgent;
  processDeps.resolveTransferConfirmation = originalResolveTransferConfirmation;
  processDeps.resolveUserFromPhone = originalResolveUserFromPhone;
  processDeps.loadHistory = originalLoadHistory;
  processDeps.saveHistory = originalSaveHistory;
});

describe("agent service", () => {
  test("GET /health returns 200", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; service: string };
    expect(json.ok).toBe(true);
    expect(json.service).toBe("agent");
  });

  test("POST /process with invalid body returns 400", async () => {
    const res = await app.request("/process", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wrong: "shape" }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /process with non-json returns 400", async () => {
    const res = await app.request("/process", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  test("POST /process returns backend confirmation reply and skips runAgent when handled", async () => {
    const reply = "Cancelado, no envié nada.";
    const runAgent = mock(async () => ({
      reply: "should not happen",
      newMessages: [],
    }));
    const resolveTransferConfirmation = mock(async (_senderPhone: string, _message: string) => ({
      handled: true as const,
      outcome: "cancelled" as const,
      reply,
    }));
    processDeps.runAgent = runAgent;
    processDeps.resolveTransferConfirmation = resolveTransferConfirmation;

    const res = await app.request("/process", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        from: "openwa:+59171234567",
        body: "no",
        conversationKey: "conv-1",
      }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reply });
    expect(resolveTransferConfirmation.mock.calls[0]?.[0]).toBe("+59171234567");
    expect(resolveTransferConfirmation.mock.calls[0]?.[1]).toBe("no");
    expect(runAgent.mock.calls.length).toBe(0);
  });

  test("POST /process — resolveTransferConfirmation throws + confirmation-shaped body → safe reply, runAgent NOT called", async () => {
    const runAgent = mock(async () => ({
      reply: "LLM reply",
      newMessages: [],
    }));
    const resolveTransferConfirmation = mock(async () => {
      throw new Error("Redis timeout");
    });
    processDeps.runAgent = runAgent;
    processDeps.resolveTransferConfirmation = resolveTransferConfirmation;

    for (const confirmBody of ["si", "sí"]) {
      const res = await app.request("/process", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          from: "whatsapp:+59171234567",
          body: confirmBody,
          conversationKey: "conv-failclosed",
        }),
      });

      expect(res.status).toBe(200);
      const json = (await res.json()) as { reply: string };
      // Must contain a safe Spanish message about retrying
      expect(json.reply).toMatch(/confirmación|confirmar|minutos|reenv/i);
      expect(runAgent.mock.calls.length).toBe(0);
    }
  });

  test("POST /process — resolveTransferConfirmation throws + non-confirmation body → falls through, runAgent IS called", async () => {
    const resolveTransferConfirmation = mock(async () => {
      throw new Error("Redis timeout");
    });
    const runAgent = mock(async () => ({
      reply: "Hola! ¿En qué te puedo ayudar?",
      newMessages: [],
    }));
    processDeps.runAgent = runAgent;
    processDeps.resolveTransferConfirmation = resolveTransferConfirmation;
    // Stub out service-dependent calls so the test doesn't hang.
    processDeps.resolveUserFromPhone = mock(async () => null);
    processDeps.loadHistory = mock(async () => []);
    processDeps.saveHistory = mock(async () => {});

    const res = await app.request("/process", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        from: "whatsapp:+59171234567",
        body: "hola, como estas?",
        conversationKey: "conv-fallthrough",
      }),
    });

    // The safe-reply guard must NOT fire for non-confirmation messages.
    const json = (await res.json()) as { reply?: string; error?: string };
    expect(json.reply ?? "").not.toMatch(/confirmación|confirmar|minutos|reenv/i);
    // runAgent was called (fallthrough path reached).
    expect(runAgent.mock.calls.length).toBe(1);
  });

  test("POST /process — confirmation.handled=true returns handled reply", async () => {
    const reply = "Listo, envié 10.00 USDC a +59199887766.";
    const resolveTransferConfirmation = mock(async () => ({
      handled: true as const,
      outcome: "confirmed" as const,
      reply,
    }));
    const runAgent = mock(async () => ({
      reply: "should not happen",
      newMessages: [],
    }));
    processDeps.runAgent = runAgent;
    processDeps.resolveTransferConfirmation = resolveTransferConfirmation;

    const res = await app.request("/process", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        from: "whatsapp:+59171234567",
        body: "si",
        conversationKey: "conv-handled",
      }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reply });
    expect(runAgent.mock.calls.length).toBe(0);
  });

  test("POST /process replayed signature returns 401 on second attempt", async () => {
    // NODE_ENV=test skips the HMAC block. Switch to "integration" to exercise it,
    // and mock all downstream deps so no DB/Redis connections are attempted.
    const origEnv = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "integration";

    const body = JSON.stringify({
      from: "whatsapp:+59171234567",
      body: "test replay",
      conversationKey: "replay-conv",
    });
    const headers = makeProcessHeaders(body);

    // resolveTransferConfirmation: return handled so runAgent is never called
    // and no DB lookups happen.
    const resolveTransferConfirmation = mock(async () => ({
      handled: true as const,
      outcome: "confirmed" as const,
      reply: "ok",
    }));
    processDeps.resolveTransferConfirmation = resolveTransferConfirmation;

    // First request — HMAC valid, nonce fresh → confirmation handled → 200
    const first = await app.request("/process", {
      method: "POST",
      headers,
      body,
    });
    expect(first.status).not.toBe(401);

    // Second request with identical headers/signature — replay rejected
    const second = await app.request("/process", {
      method: "POST",
      headers,
      body,
    });
    expect(second.status).toBe(401);
    const json = (await second.json()) as { error: string };
    expect(json.error).toBe("replayed request");

    process.env["NODE_ENV"] = origEnv;
  });
});
