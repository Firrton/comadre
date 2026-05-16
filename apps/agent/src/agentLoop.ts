/**
 * Tool-use loop for the Comadre agent.
 *
 * Each turn:
 *   1. Append the user message + run Moonshot with `tools: ALL_TOOLS`
 *   2. If the model returns `tool_calls`, execute each via `@comadre/agent-tools`
 *   3. Append the tool result message and loop (max 5 iterations)
 *   4. Return final assistant text + every new message added during the turn
 *
 * Onboarding bypass: tools listed in `TOOLS_ALLOWED_WITHOUT_WALLET` may be
 * called even when `userWallet` is null (used for the implicit Privy onboarding
 * flow when a phone messages Comadre for the first time).
 */
import type {
  ChatCompletionMessageParam,
  ChatCompletionToolMessageParam,
} from "openai/resources/chat/completions";

import { env } from "@comadre/config";
import {
  ALL_TOOLS,
  executeTool,
  type ToolContext,
  type ToolResult,
} from "@comadre/agent-tools";

import { llmClient } from "./lib/moonshotClient.js";
import { COMADRE_SYSTEM_PROMPT } from "./lib/systemPrompt.js";

export type ChatMessage = ChatCompletionMessageParam;

export interface RunAgentArgs {
  history: ChatMessage[];
  userMessage: string;
  /** null if phone is not yet registered — only iniciar_onboarding allowed. */
  userWallet: string | null;
  /** E.164 phone number (e.g. "+528116346072"), required for onboarding tool. */
  senderPhone: string;
  /** Small internal context about available/saved USDC. */
  financialContext?: string | null;
}

export interface RunAgentResult {
  reply: string;
  newMessages: ChatMessage[];
}

const MAX_TOOL_ITERATIONS = 5;
const COMADRE_LLM_TEMPERATURE = 0.3;
// `iniciar_onboarding` removed from the allowlist — the Solana plaintext-key
// flow is retired (see audit COM-032). The Monad path is `iniciar_cuenta_segura`.
const TOOLS_ALLOWED_WITHOUT_WALLET = new Set<string>(["iniciar_cuenta_segura"]);

const UNREGISTERED_TOOL_ERROR =
  "UNREGISTERED: el usuario no tiene wallet todavía. Pide consentimiento explícito ANTES de llamar `iniciar_onboarding`.";
const ONBOARDING_CONSENT_REQUIRED_ERROR =
  "CONSENT_REQUIRED: antes de crear la billetera, pedile al usuario que confirme con 'sí', 'dale' o 'registrame'.";

export function toolsForWalletState(
  userWallet: string | null,
): (typeof ALL_TOOLS)[number][] {
  if (userWallet === null) return [...ALL_TOOLS];
  return ALL_TOOLS.filter((tool) => tool.function.name !== "iniciar_onboarding");
}

function hasExplicitOnboardingConsent(message: string): boolean {
  const normalized = message
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

  if (/\b(no|nop|nunca|cancelar|cancela|no gracias)\b/.test(normalized)) {
    return false;
  }

  return /\b(si|dale|ok|okay|acepto|confirmo|registrame|registro|vamos|le damos)\b/.test(normalized);
}

function walletFromOnboardingResult(result: ToolResult): string | null {
  if (result.type !== "data" || typeof result.data !== "object" || result.data === null) {
    return null;
  }

  const walletAddress = (result.data as { walletAddress?: unknown }).walletAddress;
  return typeof walletAddress === "string" && walletAddress.length > 0
    ? walletAddress
    : null;
}

export async function runAgent({
  history,
  userMessage,
  userWallet,
  senderPhone,
  financialContext,
}: RunAgentArgs): Promise<RunAgentResult> {
  const userTurnMsg: ChatMessage = { role: "user", content: userMessage };
  const messages: ChatMessage[] = [
    { role: "system", content: COMADRE_SYSTEM_PROMPT },
    ...(financialContext ? [{ role: "system" as const, content: financialContext }] : []),
    ...history,
    userTurnMsg,
  ];
  const newMessages: ChatMessage[] = [userTurnMsg];
  let effectiveUserWallet = userWallet;

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const completion = await llmClient.chat.completions.create({
      model: env.KIMI_MODEL,
      messages,
      tools: toolsForWalletState(effectiveUserWallet),
      tool_choice: "auto",
      temperature: COMADRE_LLM_TEMPERATURE,
      max_tokens: 4000,
    });

    const choice = completion.choices[0];
    if (!choice) throw new Error("LLM returned no choices");

    const assistantMessage = choice.message;
    const assistantAsParam = assistantMessage as unknown as ChatMessage;
    messages.push(assistantAsParam);
    newMessages.push(assistantAsParam);

    const toolCalls = assistantMessage.tool_calls;

    // Final reply (no tool calls)
    if (!toolCalls || toolCalls.length === 0) {
      const reply = (assistantMessage.content ?? "").trim();
      if (reply.length === 0) {
        throw new Error(
          `LLM returned empty content (finish_reason=${choice.finish_reason})`,
        );
      }
      return { reply, newMessages };
    }

    // Execute each tool call
    for (const call of toolCalls) {
      if (call.type !== "function") {
        const errMsg: ChatCompletionToolMessageParam = {
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({
            type: "error",
            error: `Unsupported tool call type: ${call.type}`,
          } satisfies ToolResult),
        };
        messages.push(errMsg);
        newMessages.push(errMsg);
        continue;
      }

      // Reject wallet-required tools when user not registered
      if (
        effectiveUserWallet === null &&
        !TOOLS_ALLOWED_WITHOUT_WALLET.has(call.function.name)
      ) {
        const errMsg: ChatCompletionToolMessageParam = {
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({
            type: "error",
            error: UNREGISTERED_TOOL_ERROR,
          } satisfies ToolResult),
        };
        messages.push(errMsg);
        newMessages.push(errMsg);
        continue;
      }

      if (
        effectiveUserWallet === null &&
        call.function.name === "iniciar_onboarding" &&
        !hasExplicitOnboardingConsent(userMessage)
      ) {
        const errMsg: ChatCompletionToolMessageParam = {
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({
            type: "error",
            error: ONBOARDING_CONSENT_REQUIRED_ERROR,
          } satisfies ToolResult),
        };
        messages.push(errMsg);
        newMessages.push(errMsg);
        continue;
      }

      let args: unknown;
      try {
        args = JSON.parse(call.function.arguments);
      } catch (parseErr) {
        const errResult: ToolResult = {
          type: "error",
          error: `Invalid JSON args for ${call.function.name}: ${
            parseErr instanceof Error ? parseErr.message : String(parseErr)
          }`,
        };
        const toolMsg: ChatCompletionToolMessageParam = {
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(errResult),
        };
        messages.push(toolMsg);
        newMessages.push(toolMsg);
        continue;
      }

      const toolContext: ToolContext = {
        userWallet: effectiveUserWallet ?? "",
        senderPhone,
      };

      let result: ToolResult;
      try {
        result = await executeTool(call.function.name, args, toolContext);
      } catch (toolErr) {
        result = {
          type: "error",
          error:
            toolErr instanceof Error ? toolErr.message : String(toolErr),
        };
      }

      const toolMsg: ChatCompletionToolMessageParam = {
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      };
      messages.push(toolMsg);
      newMessages.push(toolMsg);

      if (call.function.name === "iniciar_onboarding") {
        effectiveUserWallet = walletFromOnboardingResult(result) ?? effectiveUserWallet;
      }
    }
  }

  return {
    reply:
      "Disculpá mija, tuve un problema procesando eso. ¿Lo intentamos de nuevo?",
    newMessages,
  };
}
