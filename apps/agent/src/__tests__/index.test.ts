import { afterEach, describe, expect, mock, test } from "bun:test";

import { app, processDeps } from "../index.js";

const originalRunAgent = processDeps.runAgent;
const originalResolveTransferConfirmation = processDeps.resolveTransferConfirmation;

afterEach(() => {
  processDeps.runAgent = originalRunAgent;
  processDeps.resolveTransferConfirmation = originalResolveTransferConfirmation;
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
});
