import OpenAI from "openai";

import { env } from "@comadre/config";

/**
 * OpenAI-compatible client pointed at the configured LLM provider.
 *
 * - LLM_PROVIDER=moonshot → https://api.moonshot.ai/v1 (default)
 * - LLM_PROVIDER=groq     → https://api.groq.com/openai/v1
 *
 * Both providers expose the standard `/chat/completions` endpoint so the
 * `openai` SDK works with either.
 */
function buildClient(): OpenAI {
  if (env.LLM_PROVIDER === "groq") {
    if (!env.GROQ_API_KEY) {
      throw new Error("LLM_PROVIDER=groq but GROQ_API_KEY not set");
    }
    return new OpenAI({
      apiKey: env.GROQ_API_KEY,
      baseURL: "https://api.groq.com/openai/v1",
    });
  }
  // moonshot (default)
  if (!env.MOONSHOT_API_KEY) {
    throw new Error("LLM_PROVIDER=moonshot but MOONSHOT_API_KEY not set");
  }
  return new OpenAI({
    apiKey: env.MOONSHOT_API_KEY,
    baseURL: "https://api.moonshot.ai/v1",
  });
}

export const llmClient: OpenAI = buildClient();
