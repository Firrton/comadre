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
 *       userWallet,
 *     });
 *   }
 */

export type { ToolContext, ToolResult, ToolDefinition, ToolExecutor } from "./types";
export { apiCall, newIdempotencyKey } from "./apiClient";
export type { ApiCallParams } from "./apiClient";

export {
  ALL_TOOLS,
  TOOL_EXECUTORS,
  executeTool,
  consultarPerfilDefinition,
  consultarTandaDefinition,
  crearTandaDefinition,
  unirseTandaDefinition,
  aportarTurnoDefinition,
  abrirDisputaDefinition,
  votarDisputaDefinition,
  solicitarKycDefinition,
  iniciarOnrampDefinition,
  consultarPerfilExecute,
  consultarTandaExecute,
  crearTandaExecute,
  unirseTandaExecute,
  aportarTurnoExecute,
  abrirDisputaExecute,
  votarDisputaExecute,
  solicitarKycExecute,
  iniciarOnrampExecute,
  // Phone-to-phone transfers (PR D)
  consultarBalanceDefinition,
  iniciarTransferDefinition,
  confirmarTransferDefinition,
  cancelarTransferDefinition,
  consultarBalanceExecute,
  iniciarTransferExecute,
  confirmarTransferExecute,
  cancelarTransferExecute,
  // Onboarding
  iniciarCuentaSeguraDefinition,
  iniciarCuentaSeguraExecute,
  consultarGuardaditoDefinition,
  prepararGuardaditoDefinition,
  confirmarGuardaditoDefinition,
  retirarGuardaditoDefinition,
  cancelarGuardaditoDefinition,
  confirmarCodigoSeguridadDefinition,
  consultarGuardaditoExecute,
  prepararGuardaditoExecute,
  confirmarGuardaditoExecute,
  retirarGuardaditoExecute,
  cancelarGuardaditoExecute,
  confirmarCodigoSeguridadExecute,
} from "./tools";
