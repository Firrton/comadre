import { describe, expect, test } from "bun:test";

import { toolsForWalletState } from "../agentLoop.js";
import { COMADRE_SYSTEM_PROMPT } from "../lib/systemPrompt.js";

describe("agent tool surface", () => {
  test("keeps onboarding available before a wallet exists", () => {
    const names = toolsForWalletState(null).map((tool) => tool.function.name);
    expect(names).toContain("iniciar_onboarding");
  });

  test("hides onboarding once the user already has a wallet", () => {
    const names = toolsForWalletState("11111111111111111111111111111111").map(
      (tool) => tool.function.name,
    );
    expect(names).not.toContain("iniciar_onboarding");
    expect(names).toContain("consultar_guardadito");
  });
});

describe("Comadre voice prompt", () => {
  test("keeps Guardadito language branded and non-technical", () => {
    expect(COMADRE_SYSTEM_PROMPT).toContain("REGLAS DE VOZ — TÍA VERA / COMADRE");
    expect(COMADRE_SYSTEM_PROMPT).toContain("No inventes diminutivos raros");
    expect(COMADRE_SYSTEM_PROMPT).toContain("guardar en tu chanchito");
    expect(COMADRE_SYSTEM_PROMPT).toContain("No muestres `actionId`, UUIDs");
  });

  test("keeps tanda prompts user-friendly", () => {
    expect(COMADRE_SYSTEM_PROMPT).toContain("Si falta solo un dato, preguntá SOLO ese dato");
    expect(COMADRE_SYSTEM_PROMPT).toContain("Nunca digas “centavos”, “payouts”, “tx”");
  });
});
