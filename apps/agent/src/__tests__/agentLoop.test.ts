import { afterEach, describe, expect, mock, test } from "bun:test";

import { agentLoopDeps, runAgent, toolsForWalletState } from "../agentLoop.js";
import { COMADRE_SYSTEM_PROMPT } from "../lib/systemPrompt.js";

const originalCreateChatCompletion = agentLoopDeps.createChatCompletion;
const originalExecuteTool = agentLoopDeps.executeTool;

afterEach(() => {
  agentLoopDeps.createChatCompletion = originalCreateChatCompletion;
  agentLoopDeps.executeTool = originalExecuteTool;
});

describe("agent tool surface", () => {
  test("keeps onboarding available before a wallet exists", () => {
    const names = toolsForWalletState(null).map((tool) => tool.function.name);
    expect(names).toContain("iniciar_cuenta_segura");
  });

  test("hides onboarding once the user already has a wallet", () => {
    const names = toolsForWalletState("11111111111111111111111111111111").map(
      (tool) => tool.function.name,
    );
    expect(names).not.toContain("iniciar_cuenta_segura");
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

  test("uses backend-driven confirmation copy for enviar_plata", () => {
    expect(COMADRE_SYSTEM_PROMPT).toContain("llamá `enviar_plata`");
    expect(COMADRE_SYSTEM_PROMPT).toContain("el backend ya trae el texto exacto");
    expect(COMADRE_SYSTEM_PROMPT).not.toContain("llamá `iniciar_transfer`");
    expect(COMADRE_SYSTEM_PROMPT).not.toContain("`confirmar_transfer({transfer_id})`");
  });
});

describe("agent loop confirmation relay", () => {
  test("returns confirmationPrompt verbatim and does not call the LLM again", async () => {
    const prompt =
      "Es la primera vez que enviás a +59176543210. ¿Confirmás enviar 7 USDC? Respondé SÍ para confirmar o NO para cancelar.";
    const createChatCompletion = mock(async () => ({
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: {
                  name: "enviar_plata",
                  arguments: JSON.stringify({
                    to_phone: "+59176543210",
                    amount_usdc: "7",
                  }),
                },
              },
            ],
          },
        },
      ],
    }));
    const executeTool = mock(async () => ({
      type: "confirmation" as const,
      confirmationPrompt: prompt,
    }));

    agentLoopDeps.createChatCompletion = createChatCompletion;
    agentLoopDeps.executeTool = executeTool;

    const result = await runAgent({
      history: [],
      userMessage: "mandá 7 USDC al +59176543210",
      userId: "user-1",
      senderPhone: "+59171234567",
    });

    expect(result.reply).toBe(prompt);
    expect(createChatCompletion.mock.calls.length).toBe(1);
    expect(executeTool.mock.calls.length).toBe(1);
  });
});
