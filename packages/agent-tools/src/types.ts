/**
 * Common types shared across all agent tools.
 *
 * Each tool exports two values:
 *   - `<ToolName>Definition`: the OpenAI-compatible tool schema (consumed by Kimi via Moonshot)
 *   - `<ToolName>Execute`: the runtime implementation called when the LLM invokes the tool
 */

export interface ToolContext {
  /** The Solana wallet (base58 pubkey) of the user this tool acts on behalf of. */
  userWallet: string;
  /** Optional idempotency key. If absent, the tool generates one (UUID v4). */
  idempotencyKey?: string;
}

/**
 * Discriminated result returned by every tool's `Execute` function.
 *
 * - `data`: the tool returned read-only information; the LLM can present it directly.
 * - `unsigned_tx`: the tool built a Solana transaction the user must sign. The agent
 *   is responsible for delivering this to the user (e.g. via a signing link).
 * - `error`: the tool failed in a recoverable way; the LLM can ask the user to retry.
 */
export type ToolResult =
  | { type: "data"; data: unknown; summary?: string }
  | { type: "unsigned_tx"; unsigned_tx_base64: string; idempotency_key: string; summary: string }
  | { type: "error"; error: string };

/**
 * OpenAI-compatible tool definition shape — what we hand to Moonshot's `tools` param.
 */
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };
  };
}

export type ToolExecutor = (args: unknown, context: ToolContext) => Promise<ToolResult>;
