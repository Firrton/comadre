import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import { env } from "@comadre/config";

import { llmClient } from "./moonshotClient.js";
import { COMADRE_SYSTEM_PROMPT } from "./systemPrompt.js";

export type ChatMessage = ChatCompletionMessageParam;

interface RunResult {
  reply: string;
  updatedMessages: ChatMessage[];
}

/**
 * Run the LLM once and return the assistant's reply.
 *
 * Kimi K2.5 is a reasoning model: `content` may be empty if `max_tokens` is
 * too low (the thinking eats tokens before the final reply is emitted). We
 * use 4000 to give headroom; tune down for cost once we have telemetry.
 *
 * No tool use yet — this is the conversational baseline. Tool integration
 * will come in a follow-up PR once the on-chain `apps/api` is callable.
 */
export async function runAgent(history: ChatMessage[]): Promise<RunResult> {
  const messages: ChatMessage[] = [
    { role: "system", content: COMADRE_SYSTEM_PROMPT },
    ...history,
  ];

  const completion = await llmClient.chat.completions.create({
    model: env.KIMI_MODEL,
    messages,
    // Kimi K2.5 only accepts temperature=1; other models accept any. We hardcode
    // 1 here for compatibility — adjust if we swap models.
    temperature: 1,
    max_tokens: 4000,
  });

  const choice = completion.choices[0];
  if (!choice) throw new Error("LLM returned no choices");

  const reply = (choice.message.content ?? "").trim();
  if (reply.length === 0) {
    throw new Error(
      `LLM returned empty content (finish_reason=${choice.finish_reason}). Increase max_tokens.`,
    );
  }

  const assistantMessage: ChatMessage = {
    role: "assistant",
    content: reply,
  };

  return {
    reply,
    updatedMessages: [...history, assistantMessage],
  };
}
