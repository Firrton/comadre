import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { resolveTransferConfirmation } from "../apiClient";
import { ALL_TOOLS, executeTool, TOOL_EXECUTORS } from "../tools";

// We mock global fetch to capture the requests each tool would emit
let lastRequest: { url: string; init: RequestInit | undefined } | null = null;
const originalFetch = globalThis.fetch;

function makeMockFetch(responseBody: unknown, _ok = true, status = 200): typeof fetch {
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

const ctx = { userId: "BfVXncFhJdSsDciLx7UzVjFbEBw1EtcnJCsYSRis54Sh" };

describe("tool registry", () => {
  it("exposes 12 tools", () => {
    expect(ALL_TOOLS.length).toBe(12);
  });

  it("includes live tools and excludes dead ones", () => {
    const names = ALL_TOOLS.map((t) => t.function.name);
    expect(names).toContain("consultar_balance");
    // Audit COM-032: iniciar_onboarding (legacy Solana plaintext-key path)
    // is intentionally NOT registered. The Monad replacement is iniciar_cuenta_segura.
    expect(names).not.toContain("iniciar_onboarding");
    expect(names).toContain("iniciar_cuenta_segura");
    expect(names).toContain("consultar_guardadito");
    expect(names).toContain("preparar_guardadito");
    expect(names).toContain("confirmar_guardadito");
    expect(names).toContain("retirar_guardadito");
    expect(names).toContain("cancelar_guardadito");
    expect(names).toContain("confirmar_codigo_seguridad");
    // Tanda tools removed — /api/v1/tandas/* route excised
    expect(names).not.toContain("consultar_tanda");
    expect(names).not.toContain("crear_tanda");
    expect(names).not.toContain("unirse_tanda");
    expect(names).not.toContain("aportar_turno");
    expect(names).not.toContain("abrir_disputa");
    expect(names).not.toContain("votar_disputa");
    expect(names).not.toContain("mis_tandas");
    // Solana transfer tools removed — /api/v1/transfers route excised
    expect(names).not.toContain("iniciar_transfer");
    expect(names).not.toContain("confirmar_transfer");
    expect(names).not.toContain("cancelar_transfer");
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
    globalThis.fetch = makeMockFetch({ wallet: ctx.userId, kyc_tier: "t0_demo" });
    const result = await executeTool("consultar_perfil", {}, ctx);
    expect(result.type).toBe("data");
    expect(lastRequest?.url).toContain("/api/v1/users/me");
    expect(lastRequest?.init?.method).toBe("GET");
    const headers = lastRequest?.init?.headers as Record<string, string>;
    expect(headers["X-Internal-Signature"]).toMatch(/^[0-9a-f]{64}$/);
    // Audit COM-006: X-Dev-Wallet is only sent in NODE_ENV=development. In
    // tests (NODE_ENV=test) the header is intentionally absent.
    if (process.env["NODE_ENV"] === "development") {
      expect(headers["X-Dev-Wallet"]).toBe(ctx.userId);
    } else {
      expect(headers["X-Dev-Wallet"]).toBeUndefined();
    }
  });
});

describe("HMAC signature", () => {
  it("signature differs for different paths", async () => {
    globalThis.fetch = makeMockFetch({ ok: true });
    await executeTool("consultar_perfil", {}, ctx);
    const sig1 = (lastRequest?.init?.headers as Record<string, string>)["X-Internal-Signature"];
    globalThis.fetch = makeMockFetch({ summary: { available: { usdc: "0" }, saved: { usdc: "0" }, suggested: { shouldSuggest: false, amountUsdc: "0", liquidReserveUsdc: "0" }, copy: { short: "", risk: "" } } });
    await executeTool("consultar_guardadito", {}, ctx);
    const sig2 = (lastRequest?.init?.headers as Record<string, string>)["X-Internal-Signature"];
    expect(sig1).not.toBe(sig2);
  });

  it("resolveTransferConfirmation POSTs to the backend confirmation endpoint with HMAC and no dev user headers", async () => {
    globalThis.fetch = makeMockFetch({ handled: false });
    const result = await resolveTransferConfirmation("+59171234567", "sí");

    expect(result).toEqual({ handled: false });
    expect(lastRequest?.url).toContain("/api/v1/transfers-monad/resolve-confirmation");
    expect(lastRequest?.init?.method).toBe("POST");
    const headers = lastRequest?.init?.headers as Record<string, string>;
    expect(headers["X-Internal-Signature"]).toMatch(/^[0-9a-f]{64}$/);
    expect(headers["X-Idempotency-Key"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(headers["X-Dev-User-Id"]).toBeUndefined();
    expect(headers["X-Dev-Wallet"]).toBeUndefined();
    expect(JSON.parse((lastRequest?.init?.body as string) ?? "{}")).toEqual({
      senderPhone: "+59171234567",
      message: "sí",
    });
  });
});

describe("enviar_plata confirmation relay", () => {
  it("returns ToolResult.confirmation with the backend prompt verbatim", async () => {
    const prompt =
      "Es la primera vez que enviás a +59176543210. ¿Confirmás enviar 7 USDC? Respondé SÍ para confirmar o NO para cancelar.";
    globalThis.fetch = makeMockFetch({
      ok: true,
      needsConfirmation: true,
      transferId: "uuid-1",
      amountUsdc: "7",
      confirmationPrompt: prompt,
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    });

    const result = await executeTool(
      "enviar_plata",
      { to_phone: "+59176543210", amount_usdc: "7" },
      { userId: "", senderPhone: "+59171234567" },
    );

    expect(result.type).toBe("confirmation");
    if (result.type === "confirmation") {
      expect(result.confirmationPrompt).toBe(prompt);
    }
  });
});

// Solana transfer tools (iniciar_transfer, confirmar_transfer, cancelar_transfer) were
// removed — /api/v1/transfers route was excised in the Monad migration.
// The active transfer path is enviar_plata → /api/v1/transfers-monad.

describe("phone onboarding tool (legacy Solana path retired — audit COM-032)", () => {
  // The legacy `iniciar_onboarding` tool (Solana plaintext-key path) was
  // removed from ALL_TOOLS and TOOL_EXECUTORS per audit COM-032. The agent
  // now exclusively uses `iniciar_cuenta_segura` for the Monad ERC-4337 flow.
  it("rejects iniciar_onboarding as unknown (registration removed)", async () => {
    const result = await executeTool("iniciar_onboarding", {}, {
      userId: "",
      senderPhone: "+528116346072",
    });
    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.error).toContain("Unknown tool");
    }
  });
});

describe("Guardadito tools", () => {
  it("consultar_guardadito GETs /api/v1/savings/summary", async () => {
    globalThis.fetch = makeMockFetch({
      available: { usdc: "50", microUsdc: "50000000" },
      saved: { usdc: "0", microUsdc: "0" },
      suggested: {
        shouldSuggest: true,
        amountUsdc: "30",
        microUsdc: "30000000",
        liquidReserveUsdc: "20",
        reason: "ok",
      },
      copy: { short: "Mija...", risk: "Puede variar." },
    });

    const result = await executeTool("consultar_guardadito", {}, ctx);
    expect(result.type).toBe("data");
    expect(lastRequest?.url).toContain("/api/v1/savings/summary");
    expect(lastRequest?.init?.method).toBe("GET");
  });

  it("preparar_guardadito POSTs deposit amount", async () => {
    globalThis.fetch = makeMockFetch({
      actionId: "00000000-0000-0000-0000-000000000001",
      type: "deposit",
      provider: "mock",
      strategyId: "guardadito-mock-usdc",
      amount: { usdc: "30", microUsdc: "30000000" },
      status: "pending",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      summary: "ok",
    });

    const result = await executeTool("preparar_guardadito", { amount_usdc: "30" }, ctx);
    expect(result.type).toBe("data");
    expect(lastRequest?.url).toContain("/api/v1/savings/deposits");
    const body = JSON.parse((lastRequest?.init?.body as string) ?? "{}");
    expect(body.amountUsdc).toBe("30");
  });

  it("confirmar_guardadito POSTs action confirmation", async () => {
    globalThis.fetch = makeMockFetch({
      actionId: "00000000-0000-0000-0000-000000000001",
      status: "confirmed",
    });

    const result = await executeTool(
      "confirmar_guardadito",
      { action_id: "00000000-0000-0000-0000-000000000001" },
      ctx,
    );
    expect(result.type).toBe("data");
    expect(lastRequest?.url).toContain("/api/v1/savings/actions/00000000-0000-0000-0000-000000000001/confirm");
  });
});

describe("confirmar_codigo_seguridad", () => {
  it("POSTs code to /api/v1/elevated-intents/:id/confirm", async () => {
    globalThis.fetch = makeMockFetch({ ok: true, intent_id: "intent-1", action: { phoneE164: "+5491112345678" } });
    const result = await executeTool(
      "confirmar_codigo_seguridad",
      { intent_id: "intent-1", code: "123456" },
      ctx,
    );
    expect(result.type).toBe("data");
    expect(lastRequest?.url).toContain("/api/v1/elevated-intents/intent-1/confirm");
    expect(lastRequest?.init?.method).toBe("POST");
    const body = JSON.parse((lastRequest?.init?.body as string) ?? "{}");
    expect(body.code).toBe("123456");
  });

  it("returns error summary on 401 invalid_code", async () => {
    globalThis.fetch = makeMockFetch({ error: "invalid_code" }, false, 401);
    const result = await executeTool(
      "confirmar_codigo_seguridad",
      { intent_id: "intent-1", code: "000000" },
      ctx,
    );
    expect(result.type).toBe("error");
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
