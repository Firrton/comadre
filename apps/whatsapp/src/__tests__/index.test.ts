import { describe, expect, test } from "bun:test";

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
});
