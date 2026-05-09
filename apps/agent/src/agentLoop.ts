/**
 * Tool-use loop for the Comadre agent.
 *
 * Each turn:
 *   1. Append the user message to history
 *   2. Call Moonshot Kimi with `tools: ALL_TOOLS`
 *   3. If the model returns `tool_calls`, execute each via `@comadre/agent-tools`
 *      and append the tool result message
 *   4. Loop up to MAX_TOOL_ITERATIONS times
 *   5. Return the final assistant text + every new message added to history
 *
 * Quirks:
 *   - Kimi requires `temperature: 1` for k2.5/k2.6 reasoning models. Other
 *     models accept any value; we hardcode 1 for compatibility.
 *   - `max_tokens: 4000` gives the reasoning models headroom; non-reasoning
 *     models will use far fewer.
 *   - If `userWallet` is null (unregistered phone), every tool_call is rejected
 *     with a friendly error so the LLM can re-explain to the user.
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

import { llmClient } from "./moonshotClient.js";
import { COMADRE_SYSTEM_PROMPT } from "./systemPrompt.js";

export type ChatMessage = ChatCompletionMessageParam;

export interface RunAgentArgs {
  /** Prior conversation turns (without the current user message). */
  history: ChatMessage[];
  /** The current incoming user message text. */
  userMessage: string;
  /**
   * The Solana wallet of the user we're acting for. `null` if the phone is
   * not yet registered — only `iniciar_onboarding` is allowed in that case.
   */
  userWallet: string | null;
  /**
   * E.164 phone number of the user (e.g. "+5218116346072"), required so the
   * onboarding tool can bind the new Privy user to the right phone.
   */
  senderPhone: string;
}

/** Tools that don't require a registered userWallet (used for onboarding). */
const TOOLS_ALLOWED_WITHOUT_WALLET = new Set<string>(["iniciar_onboarding"]);

export interface RunAgentResult {
  /** Final assistant text to send back to the user. */
  reply: string;
  /**
   * All messages produced this turn (user msg + assistant turns + tool replies).
   * Caller appends these to history and persists.
   */
  newMessages: ChatMessage[];
}

const MAX_TOOL_ITERATIONS = 5;

const UNREGISTERED_TOOL_ERROR =
  "UNREGISTERED: el usuario no tiene wallet todavia. LLAMA `iniciar_onboarding` PRIMERO para crearle el wallet, luego reintenta esta accion.";

export async function runAgent({
  history,
  userMessage,
  userWallet,
  senderPhone,
}: RunAgentArgs): Promise<RunAgentResult> {
  // Working message buffer — what we send to the LLM each iteration.
  const userTurnMsg: ChatMessage = { role: "user", content: userMessage };
  const messages: ChatMessage[] = [
    { role: "system", content: COMADRE_SYSTEM_PROMPT },
    ...history,
    userTurnMsg,
  ];

  // Messages added during this turn that the caller should persist.
  const newMessages: ChatMessage[] = [userTurnMsg];

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const completion = await llmClient.chat.completions.create({
      model: env.KIMI_MODEL,
      messages,
      // Spread to a mutable copy — OpenAI's type expects mutable, our registry is readonly.
      tools: [...ALL_TOOLS],
      tool_choice: "auto",
      temperature: 1,
      max_tokens: 4000,
    });

    const choice = completion.choices[0];
    if (!choice) throw new Error("LLM returned no choices");

    const assistantMessage = choice.message;
    // The OpenAI types differ slightly from ChatCompletionMessageParam, but the
    // shape is compatible for our subsequent calls. Cast through unknown.
    const assistantAsParam = assistantMessage as unknown as ChatMessage;
    messages.push(assistantAsParam);
    newMessages.push(assistantAsParam);

    const toolCalls = assistantMessage.tool_calls;

    // No tool calls → final reply
    if (!toolCalls || toolCalls.length === 0) {
      const reply = (assistantMessage.content ?? "").trim();
      if (reply.length === 0) {
        throw new Error(
          `LLM returned empty content (finish_reason=${choice.finish_reason}). Increase max_tokens or check tool definitions.`,
        );
      }
      return { reply, newMessages };
    }

    // Execute each tool call (or reject if user not registered)
    for (const call of toolCalls) {
      // Function-style tool calls only — Moonshot doesn't currently emit other types.
      if (call.type !== "function") {
        const errorMsg: ChatCompletionToolMessageParam = {
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({
            type: "error",
            error: `Unsupported tool call type: ${call.type}`,
          } satisfies ToolResult),
        };
        messages.push(errorMsg);
        newMessages.push(errorMsg);
        continue;
      }

      // If user is not registered, only allow whitelisted tools (onboarding).
      // For everything else, return a structured error so the LLM knows to call
      // `iniciar_onboarding` first.
      if (
        userWallet === null &&
        !TOOLS_ALLOWED_WITHOUT_WALLET.has(call.function.name)
      ) {
        const errorMsg: ChatCompletionToolMessageParam = {
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({
            type: "error",
            error: UNREGISTERED_TOOL_ERROR,
          } satisfies ToolResult),
        };
        messages.push(errorMsg);
        newMessages.push(errorMsg);
        continue;
      }

      // Parse JSON args (model can emit malformed JSON occasionally)
      let args: unknown;
      try {
        args = JSON.parse(call.function.arguments);
      } catch (parseErr) {
        const errResult: ToolResult = {
          type: "error",
          error: `Invalid JSON arguments for ${call.function.name}: ${
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
        // Onboarding tools may run with empty wallet; everything else passes through real wallet
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

  // Hit max iterations without a final text reply — return a fallback so the
  // user gets *something* back instead of a 500.
  return {
    reply:
      "Disculpá mija, tuve un problema procesando eso. ¿Podemos intentarlo de nuevo?",
    newMessages,
  };
}
