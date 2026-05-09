import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { ALL_TOOLS, executeTool, TOOL_EXECUTORS } from "../tools";

// We mock global fetch to capture the requests each tool would emit
let lastRequest: { url: string; init: RequestInit | undefined } | null = null;
const originalFetch = globalThis.fetch;

function makeMockFetch(responseBody: unknown, ok = true, status = 200): typeof fetch {
  return mock(async (url: string | URL | Request, init?: RequestInit) => {
    lastRequest = { url: String(url), init };
    return new Response(JSON.stringify(responseBody), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  lastRequest = null;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const ctx = { userWallet: "BfVXncFhJdSsDciLx7UzVjFbEBw1EtcnJCsYSRis54Sh" };

describe("tool registry", () => {
  it("exposes 9 tools", () => {
    expect(ALL_TOOLS.length).toBe(9);
  });

  it("every tool name maps to an executor", () => {
    for (const tool of ALL_TOOLS) {
      expect(TOOL_EXECUTORS[tool.function.name]).toBeFunction();
    }
  });

  it("executeTool returns error on unknown name", async () => {
    const result = await executeTool("does_not_exist", {}, ctx);
    expect(result.type).toBe("error");
  });
});

describe("read-only tools", () => {
  it("consultar_perfil → GET /api/v1/users/me", async () => {
    globalThis.fetch = makeMockFetch({ wallet: ctx.userWallet, kyc_tier: "t0_demo" });
    const result = await executeTool("consultar_perfil", {}, ctx);
    expect(result.type).toBe("data");
    expect(lastRequest?.url).toContain("/api/v1/users/me");
    expect(lastRequest?.init?.method).toBe("GET");
    const headers = lastRequest?.init?.headers as Record<string, string>;
    expect(headers["X-Internal-Signature"]).toMatch(/^[0-9a-f]{64}$/);
    expect(headers["X-Dev-Wallet"]).toBe(ctx.userWallet);
  });

  it("consultar_tanda → GET /api/v1/tandas/:id", async () => {
    globalThis.fetch = makeMockFetch({ id: "TandA1", state: "forming" });
    const result = await executeTool("consultar_tanda", { tanda_id: "TandA1" }, ctx);
    expect(result.type).toBe("data");
    expect(lastRequest?.url).toContain("/api/v1/tandas/TandA1");
  });
});

describe("crear_tanda", () => {
  it("converts cents → atomic and days → seconds", async () => {
    globalThis.fetch = makeMockFetch({ unsigned_tx: "AAA=", idempotency_key: "k1" });
    const result = await executeTool(
      "crear_tanda",
      {
        name: "Vamos por la casa",
        member_target: 5,
        contribution_amount_cents: 5000, // $50
        frequency_days: 7,
        payout_order_mode: "join_order",
      },
      ctx
    );
    expect(result.type).toBe("unsigned_tx");
    expect(lastRequest?.init?.method).toBe("POST");
    const body = JSON.parse((lastRequest?.init?.body as string) ?? "{}");
    // 5000 cents × 10_000 = 50_000_000 atomic (USDC has 6 decimals; $50 = 50_000_000 atomic)
    expect(body.contribution_amount).toBe("50000000");
    expect(body.stake_amount).toBe("50000000");
    // 7 days × 86_400 = 604_800 seconds
    expect(body.frequency_seconds).toBe("604800");
    expect(body.payout_order_mode).toBe("join_order");
  });

  it("rejects negative cents (RangeError)", async () => {
    globalThis.fetch = makeMockFetch({ unsigned_tx: "AAA=", idempotency_key: "k1" });
    const result = await executeTool(
      "crear_tanda",
      {
        name: "x",
        member_target: 3,
        contribution_amount_cents: -1,
        frequency_days: 1,
        payout_order_mode: "join_order",
      },
      ctx
    );
    expect(result.type).toBe("error");
  });
});

describe("HMAC signature", () => {
  it("signature differs for different paths", async () => {
    globalThis.fetch = makeMockFetch({ ok: true });
    await executeTool("consultar_perfil", {}, ctx);
    const sig1 = (lastRequest?.init?.headers as Record<string, string>)["X-Internal-Signature"];
    globalThis.fetch = makeMockFetch({ id: "x" });
    await executeTool("consultar_tanda", { tanda_id: "x" }, ctx);
    const sig2 = (lastRequest?.init?.headers as Record<string, string>)["X-Internal-Signature"];
    expect(sig1).not.toBe(sig2);
  });
});

describe("error propagation", () => {
  it("non-2xx response surfaces as ToolResult.error", async () => {
    globalThis.fetch = makeMockFetch({ error: "validation" }, false, 400);
    const result = await executeTool("consultar_perfil", {}, ctx);
    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.error).toContain("400");
    }
  });
});
