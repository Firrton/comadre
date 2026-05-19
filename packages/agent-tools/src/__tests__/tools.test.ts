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
  it("exposes 20 tools", () => {
    expect(ALL_TOOLS.length).toBe(20);
  });

  it("includes transfer and onboarding tools", () => {
    const names = ALL_TOOLS.map((t) => t.function.name);
    expect(names).toContain("consultar_balance");
    expect(names).toContain("iniciar_transfer");
    expect(names).toContain("confirmar_transfer");
    expect(names).toContain("cancelar_transfer");
    // Audit COM-032: iniciar_onboarding (legacy Solana plaintext-key path)
    // is intentionally NOT registered. The Monad replacement is iniciar_cuenta_segura.
    expect(names).not.toContain("iniciar_onboarding");
    expect(names).toContain("iniciar_cuenta_segura");
    expect(names).toContain("consultar_guardadito");
    expect(names).toContain("preparar_guardadito");
    expect(names).toContain("confirmar_guardadito");
    expect(names).toContain("retirar_guardadito");
    expect(names).toContain("cancelar_guardadito");
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
    // Audit COM-006: X-Dev-Wallet is only sent in NODE_ENV=development. In
    // tests (NODE_ENV=test) the header is intentionally absent.
    if (process.env["NODE_ENV"] === "development") {
      expect(headers["X-Dev-Wallet"]).toBe(ctx.userWallet);
    } else {
      expect(headers["X-Dev-Wallet"]).toBeUndefined();
    }
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
    expect(body.frequency_seconds).toBe(604800);
    expect(body.payout_order_mode).toBe("join_order");
    expect(body.usdc_mint).toBe("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
  });

  it("returns data when API creates the tanda on-chain", async () => {
    globalThis.fetch = makeMockFetch({
      tanda_id: "TandaPda1111111111111111111111111111111",
      signature: "Sig111",
      explorer_url: "https://solscan.io/tx/Sig111?cluster=devnet",
    });
    const result = await executeTool(
      "crear_tanda",
      {
        name: "Ahorros",
        member_target: 3,
        contribution_amount_cents: 1000,
        frequency_days: 7,
        payout_order_mode: "join_order",
      },
      ctx
    );

    expect(result.type).toBe("data");
    if (result.type === "data") {
      expect(result.summary).toContain('Tanda "Ahorros" creada');
    }
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

describe("phone-to-phone transfer tools (PR D)", () => {
  const validResp = {
    mode: "immediate",
    transferId: "uuid-1",
    recipient: { registered: true, phone: "+5218116346072", wallet: "Ag4...J4yX", walletPreview: "...J4yX" },
    amount: { usdc: "10.50", microUsdc: "10500000" },
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    unsignedTxBase64: "AAAA",
  };

  it("iniciar_transfer POSTs to /api/v1/transfers with toPhone/amountUsdc/note", async () => {
    globalThis.fetch = makeMockFetch(validResp);
    const result = await executeTool(
      "iniciar_transfer",
      { to_phone: "+5218116346072", amount_usdc: "10.50", note: "almuerzo" },
      ctx
    );
    expect(result.type).toBe("data");
    expect(lastRequest?.url).toContain("/api/v1/transfers");
    const body = JSON.parse((lastRequest?.init?.body as string) ?? "{}");
    expect(body.toPhone).toBe("+5218116346072");
    expect(body.amountUsdc).toBe("10.50");
    expect(body.note).toBe("almuerzo");
  });

  it("iniciar_transfer surfaces 'deferred' summary when recipient unregistered", async () => {
    globalThis.fetch = makeMockFetch({
      mode: "deferred",
      transferId: "uuid-2",
      recipient: { registered: false, phone: "+5218116346072" },
      amount: { usdc: "10.50", microUsdc: "10500000" },
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(),
      message: "María te quiere mandar 10.5 USDC. Para reclamar...",
    });
    const result = await executeTool(
      "iniciar_transfer",
      { to_phone: "+5218116346072", amount_usdc: "10.50" },
      ctx
    );
    expect(result.type).toBe("data");
    if (result.type === "data") {
      expect(result.summary).toMatch(/no está registrado/);
    }
  });

  it("confirmar_transfer POSTs to /api/v1/transfers/:id/confirm", async () => {
    globalThis.fetch = makeMockFetch({
      signature: "5kx7abc",
      status: "confirmed",
      explorerUrl: "https://explorer.solana.com/tx/5kx7abc?cluster=devnet",
    });
    const result = await executeTool("confirmar_transfer", { transfer_id: "uuid-1" }, ctx);
    expect(result.type).toBe("data");
    expect(lastRequest?.url).toContain("/api/v1/transfers/uuid-1/confirm");
    if (result.type === "data") {
      expect(result.summary).toContain("✅");
    }
  });

  it("cancelar_transfer POSTs to /api/v1/transfers/:id/cancel", async () => {
    globalThis.fetch = makeMockFetch({ status: "cancelled", transferId: "uuid-1" });
    const result = await executeTool("cancelar_transfer", { transfer_id: "uuid-1" }, ctx);
    expect(result.type).toBe("data");
    expect(lastRequest?.url).toContain("/api/v1/transfers/uuid-1/cancel");
  });
});

describe("phone onboarding tool (legacy Solana path retired — audit COM-032)", () => {
  // The legacy `iniciar_onboarding` tool (Solana plaintext-key path) was
  // removed from ALL_TOOLS and TOOL_EXECUTORS per audit COM-032. The agent
  // now exclusively uses `iniciar_cuenta_segura` for the Monad ERC-4337 flow.
  it("rejects iniciar_onboarding as unknown (registration removed)", async () => {
    const result = await executeTool("iniciar_onboarding", {}, {
      userWallet: "",
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
