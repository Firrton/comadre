import { describe, expect, test } from "bun:test";

import { app } from "../index.js";

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
});
