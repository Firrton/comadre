/**
 * @comadre/agent-tools — Kimi tool definitions + executors for the WhatsApp agent.
 *
 * Usage in apps/agent:
 *   import { ALL_TOOLS, executeTool } from "@comadre/agent-tools";
 *
 *   const completion = await client.chat.completions.create({
 *     model: env.KIMI_MODEL,
 *     messages,
 *     tools: ALL_TOOLS,
 *   });
 *
 *   for (const call of completion.choices[0].message.tool_calls ?? []) {
 *     const result = await executeTool(call.function.name, JSON.parse(call.function.arguments), {
 *       userId,
 *     });
 *   }
 */

export type { ToolContext, ToolResult, ToolDefinition, ToolExecutor } from "./types";
export { apiCall, newIdempotencyKey, resolveTransferConfirmation } from "./apiClient";
export type { ApiCallParams, ResolveTransferConfirmationResult } from "./apiClient";

export {
  ALL_TOOLS,
  TOOL_EXECUTORS,
  executeTool,
  // Profile & KYC
  consultarPerfilDefinition,
  consultarPerfilExecute,
  solicitarKycDefinition,
  solicitarKycExecute,
  // Ramps
  iniciarOnrampDefinition,
  iniciarOnrampExecute,
  // Wallet balance
  consultarBalanceDefinition,
  consultarBalanceExecute,
  // Onboarding (Monad)
  iniciarCuentaSeguraDefinition,
  iniciarCuentaSeguraExecute,
  // Monad transfers
  enviarPlataDefinition,
  enviarPlataExecute,
  // Guardadito savings
  consultarGuardaditoDefinition,
  consultarGuardaditoExecute,
  prepararGuardaditoDefinition,
  prepararGuardaditoExecute,
  confirmarGuardaditoDefinition,
  confirmarGuardaditoExecute,
  retirarGuardaditoDefinition,
  retirarGuardaditoExecute,
  cancelarGuardaditoDefinition,
  cancelarGuardaditoExecute,
  // OTP escalation
  confirmarCodigoSeguridadDefinition,
  confirmarCodigoSeguridadExecute,
} from "./tools";
