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
}

export interface RunAgentResult {
  reply: string;
  newMessages: ChatMessage[];
}

const MAX_TOOL_ITERATIONS = 5;
const TOOLS_ALLOWED_WITHOUT_WALLET = new Set<string>(["iniciar_onboarding"]);

const UNREGISTERED_TOOL_ERROR =
  "UNREGISTERED: el usuario no tiene wallet todavía. Pide consentimiento explícito ANTES de llamar `iniciar_onboarding`.";

export async function runAgent({
  history,
  userMessage,
  userWallet,
  senderPhone,
}: RunAgentArgs): Promise<RunAgentResult> {
  const userTurnMsg: ChatMessage = { role: "user", content: userMessage };
  const messages: ChatMessage[] = [
    { role: "system", content: COMADRE_SYSTEM_PROMPT },
    ...history,
    userTurnMsg,
  ];
  const newMessages: ChatMessage[] = [userTurnMsg];

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const completion = await llmClient.chat.completions.create({
      model: env.KIMI_MODEL,
      messages,
      tools: [...ALL_TOOLS],
      tool_choice: "auto",
      temperature: 1,
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
        userWallet === null &&
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
        userWallet: userWallet ?? "",
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
    }
  }

  return {
    reply:
      "Disculpá mija, tuve un problema procesando eso. ¿Lo intentamos de nuevo?",
    newMessages,
  };
}
