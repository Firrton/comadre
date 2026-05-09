/**
 * The 9 Comadre agent tools.
 *
 * Convention per tool:
 *   - <toolName>Definition: OpenAI-compatible tool schema given to Kimi via Moonshot
 *   - <toolName>Execute(args, context): runtime implementation that calls apps/api
 *
 * Args are validated at the boundary by `apps/api` (Zod schemas in @comadre/types).
 * Here we accept `unknown` and forward — the API is the source-of-truth on validation.
 */
import { apiCall, newIdempotencyKey } from "./apiClient";
import type { ToolContext, ToolDefinition, ToolExecutor, ToolResult } from "./types";

// --------------------------------------------------------------------------
// Helpers — USDC has 6 decimals; convert from "USD cents" surface to atomic units
// --------------------------------------------------------------------------
const CENTS_TO_ATOMIC = 10_000n; // 1 USD = 100 cents = 1_000_000 atomic; 1 cent = 10_000 atomic

function centsToAtomic(cents: number): bigint {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new RangeError(`amount_cents must be a non-negative integer, got ${cents}`);
  }
  return BigInt(cents) * CENTS_TO_ATOMIC;
}

function daysToSeconds(days: number): bigint {
  if (!Number.isInteger(days) || days < 1) {
    throw new RangeError(`frequency_days must be a positive integer, got ${days}`);
  }
  return BigInt(days) * 86_400n;
}

// --------------------------------------------------------------------------
// 1. consultar_perfil
// --------------------------------------------------------------------------
export const consultarPerfilDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "consultar_perfil",
    description:
      "Consulta el perfil del usuario actual: nivel de KYC, reputación, tandas completadas, país. Usa esta tool cuando el usuario pregunte sobre su cuenta.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
};
export const consultarPerfilExecute: ToolExecutor = async (_args, context) => {
  const data = await apiCall<unknown>({
    method: "GET",
    path: "/api/v1/users/me",
    userWallet: context.userWallet,
  });
  return { type: "data", data, summary: "Perfil cargado" };
};

// --------------------------------------------------------------------------
// 2. consultar_tanda
// --------------------------------------------------------------------------
export const consultarTandaDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "consultar_tanda",
    description:
      "Consulta los detalles de una tanda específica (estado, miembros, turno actual, próximo payout). Args: tanda_id (Solana pubkey base58 de la tanda).",
    parameters: {
      type: "object",
      properties: {
        tanda_id: {
          type: "string",
          description: "Pubkey base58 de la tanda (32-44 chars).",
        },
      },
      required: ["tanda_id"],
      additionalProperties: false,
    },
  },
};
export const consultarTandaExecute: ToolExecutor = async (args, context) => {
  const { tanda_id } = args as { tanda_id: string };
  const data = await apiCall<unknown>({
    method: "GET",
    path: `/api/v1/tandas/${encodeURIComponent(tanda_id)}`,
    userWallet: context.userWallet,
  });
  return { type: "data", data, summary: `Tanda ${tanda_id} cargada` };
};

// --------------------------------------------------------------------------
// 3. crear_tanda
// --------------------------------------------------------------------------
export const crearTandaDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "crear_tanda",
    description:
      "Crear una nueva tanda (grupo de ahorro rotativo). El stake es 1× el aporte. Devuelve una tx sin firmar que el usuario debe firmar para confirmar.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          maxLength: 32,
          description: "Nombre legible de la tanda (≤32 chars).",
        },
        member_target: {
          type: "integer",
          minimum: 3,
          maximum: 20,
          description: "Cantidad de miembros (3-20).",
        },
        contribution_amount_cents: {
          type: "integer",
          minimum: 100,
          description: "Aporte por turno en centavos USD. Ej: 5000 = $50.",
        },
        frequency_days: {
          type: "integer",
          minimum: 1,
          description: "Días entre payouts. Ej: 7 = semanal, 30 = mensual.",
        },
        payout_order_mode: {
          type: "string",
          enum: ["join_order", "creator_set"],
          description:
            "join_order = paga en el orden en que se sumaron los miembros. creator_set = el creador asigna el orden al inicio.",
        },
      },
      required: ["name", "member_target", "contribution_amount_cents", "frequency_days", "payout_order_mode"],
      additionalProperties: false,
    },
  },
};

interface CrearTandaArgs {
  name: string;
  member_target: number;
  contribution_amount_cents: number;
  frequency_days: number;
  payout_order_mode: "join_order" | "creator_set";
}

export const crearTandaExecute: ToolExecutor = async (args, context) => {
  const a = args as CrearTandaArgs;
  const idempotencyKey = context.idempotencyKey ?? newIdempotencyKey();
  const atomic = centsToAtomic(a.contribution_amount_cents);
  const result = await apiCall<{ unsigned_tx: string; idempotency_key: string }>({
    method: "POST",
    path: "/api/v1/tandas",
    body: {
      name: a.name,
      member_target: a.member_target,
      contribution_amount: atomic.toString(),
      stake_amount: atomic.toString(), // 1× stake-to-contribution per CHECKLIST
      frequency_seconds: daysToSeconds(a.frequency_days).toString(),
      payout_order_mode: a.payout_order_mode,
    },
    userWallet: context.userWallet,
    idempotencyKey,
  });
  const dollars = (a.contribution_amount_cents / 100).toFixed(2);
  return {
    type: "unsigned_tx",
    unsigned_tx_base64: result.unsigned_tx,
    idempotency_key: result.idempotency_key ?? idempotencyKey,
    summary: `Tanda "${a.name}" lista para crear: ${a.member_target} miembros, $${dollars} cada ${a.frequency_days} días.`,
  };
};

// --------------------------------------------------------------------------
// 4. unirse_tanda
// --------------------------------------------------------------------------
export const unirseTandaDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "unirse_tanda",
    description:
      "Unirse a una tanda existente (requiere stake + verificación KYC suficiente). Devuelve tx sin firmar.",
    parameters: {
      type: "object",
      properties: {
        tanda_id: { type: "string", description: "Pubkey base58 de la tanda a unirse." },
      },
      required: ["tanda_id"],
      additionalProperties: false,
    },
  },
};
export const unirseTandaExecute: ToolExecutor = async (args, context) => {
  const { tanda_id } = args as { tanda_id: string };
  const idempotencyKey = context.idempotencyKey ?? newIdempotencyKey();
  const result = await apiCall<{ unsigned_tx: string; idempotency_key: string }>({
    method: "POST",
    path: `/api/v1/tandas/${encodeURIComponent(tanda_id)}/join`,
    body: {},
    userWallet: context.userWallet,
    idempotencyKey,
  });
  return {
    type: "unsigned_tx",
    unsigned_tx_base64: result.unsigned_tx,
    idempotency_key: result.idempotency_key ?? idempotencyKey,
    summary: `Listo para unirte a la tanda ${tanda_id}. Firma para confirmar.`,
  };
};

// --------------------------------------------------------------------------
// 5. aportar_turno
// --------------------------------------------------------------------------
export const aportarTurnoDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "aportar_turno",
    description:
      "Hacer el aporte del turno actual de una tanda activa. Devuelve tx sin firmar con el monto exacto del aporte.",
    parameters: {
      type: "object",
      properties: {
        tanda_id: { type: "string", description: "Pubkey base58 de la tanda." },
      },
      required: ["tanda_id"],
      additionalProperties: false,
    },
  },
};
export const aportarTurnoExecute: ToolExecutor = async (args, context) => {
  const { tanda_id } = args as { tanda_id: string };
  const idempotencyKey = context.idempotencyKey ?? newIdempotencyKey();
  const result = await apiCall<{ unsigned_tx: string; idempotency_key: string }>({
    method: "POST",
    path: `/api/v1/tandas/${encodeURIComponent(tanda_id)}/contribute`,
    body: {},
    userWallet: context.userWallet,
    idempotencyKey,
  });
  return {
    type: "unsigned_tx",
    unsigned_tx_base64: result.unsigned_tx,
    idempotency_key: result.idempotency_key ?? idempotencyKey,
    summary: `Aporte del turno actual listo. Firma para confirmar.`,
  };
};

// --------------------------------------------------------------------------
// 6. abrir_disputa
// --------------------------------------------------------------------------
export const abrirDisputaDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "abrir_disputa",
    description:
      "Abrir una disputa contra una tanda activa (pausa la tanda y abre votación de 7 días entre miembros).",
    parameters: {
      type: "object",
      properties: {
        tanda_id: { type: "string", description: "Pubkey base58 de la tanda." },
        reason: {
          type: "string",
          maxLength: 280,
          description: "Razón de la disputa (≤280 chars). Se hashea on-chain por privacidad.",
        },
      },
      required: ["tanda_id", "reason"],
      additionalProperties: false,
    },
  },
};
export const abrirDisputaExecute: ToolExecutor = async (args, context) => {
  const { tanda_id, reason } = args as { tanda_id: string; reason: string };
  const idempotencyKey = context.idempotencyKey ?? newIdempotencyKey();
  const result = await apiCall<{ unsigned_tx: string; idempotency_key: string }>({
    method: "POST",
    path: `/api/v1/tandas/${encodeURIComponent(tanda_id)}/disputes`,
    body: { reason },
    userWallet: context.userWallet,
    idempotencyKey,
  });
  return {
    type: "unsigned_tx",
    unsigned_tx_base64: result.unsigned_tx,
    idempotency_key: result.idempotency_key ?? idempotencyKey,
    summary: `Disputa lista para abrir en ${tanda_id}. Firma para confirmar.`,
  };
};

// --------------------------------------------------------------------------
// 7. votar_disputa
// --------------------------------------------------------------------------
export const votarDisputaDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "votar_disputa",
    description: "Votar en una disputa abierta. continue_tanda=true para seguir, false para cancelar.",
    parameters: {
      type: "object",
      properties: {
        dispute_id: { type: "string", description: "Pubkey base58 de la disputa." },
        continue_tanda: { type: "boolean", description: "true = seguir tanda, false = cancelar." },
      },
      required: ["dispute_id", "continue_tanda"],
      additionalProperties: false,
    },
  },
};
export const votarDisputaExecute: ToolExecutor = async (args, context) => {
  const { dispute_id, continue_tanda } = args as { dispute_id: string; continue_tanda: boolean };
  const idempotencyKey = context.idempotencyKey ?? newIdempotencyKey();
  const result = await apiCall<{ unsigned_tx: string; idempotency_key: string }>({
    method: "POST",
    path: `/api/v1/disputes/${encodeURIComponent(dispute_id)}/vote`,
    body: { continue_tanda },
    userWallet: context.userWallet,
    idempotencyKey,
  });
  return {
    type: "unsigned_tx",
    unsigned_tx_base64: result.unsigned_tx,
    idempotency_key: result.idempotency_key ?? idempotencyKey,
    summary: `Voto ${continue_tanda ? "a favor de seguir" : "a favor de cancelar"} listo. Firma para confirmar.`,
  };
};

// --------------------------------------------------------------------------
// 8. solicitar_kyc
// --------------------------------------------------------------------------
export const solicitarKycDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "solicitar_kyc",
    description:
      "Iniciar o avanzar el proceso de verificación KYC (Sumsub). Devuelve un access token + link para que el usuario complete la verificación.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
};
export const solicitarKycExecute: ToolExecutor = async (_args, context) => {
  const idempotencyKey = context.idempotencyKey ?? newIdempotencyKey();
  const data = await apiCall<unknown>({
    method: "POST",
    path: "/api/v1/kyc/session",
    body: {},
    userWallet: context.userWallet,
    idempotencyKey,
  });
  return { type: "data", data, summary: "Sesión KYC iniciada" };
};

// --------------------------------------------------------------------------
// 9. iniciar_onramp
// --------------------------------------------------------------------------
export const iniciarOnrampDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "iniciar_onramp",
    description: "Cotizar la compra de USDC pagando en moneda fiat (mock por ahora).",
    parameters: {
      type: "object",
      properties: {
        fiat_currency: {
          type: "string",
          minLength: 3,
          maxLength: 3,
          description: "ISO 4217 (USD, ARS, MXN, etc).",
        },
        amount_cents: {
          type: "integer",
          minimum: 100,
          description: "Monto en centavos de la moneda fiat.",
        },
      },
      required: ["fiat_currency", "amount_cents"],
      additionalProperties: false,
    },
  },
};
export const iniciarOnrampExecute: ToolExecutor = async (args, context) => {
  const { fiat_currency, amount_cents } = args as { fiat_currency: string; amount_cents: number };
  const idempotencyKey = context.idempotencyKey ?? newIdempotencyKey();
  const data = await apiCall<unknown>({
    method: "POST",
    path: "/api/v1/onramp/quote",
    body: { fiat_currency, fiat_amount_cents: amount_cents, user_wallet: context.userWallet },
    userWallet: context.userWallet,
    idempotencyKey,
  });
  const dollars = (amount_cents / 100).toFixed(2);
  return { type: "data", data, summary: `Cotización on-ramp para ${fiat_currency} ${dollars}` };
};

// --------------------------------------------------------------------------
// Registry
// --------------------------------------------------------------------------
export const ALL_TOOLS: readonly ToolDefinition[] = [
  consultarPerfilDefinition,
  consultarTandaDefinition,
  crearTandaDefinition,
  unirseTandaDefinition,
  aportarTurnoDefinition,
  abrirDisputaDefinition,
  votarDisputaDefinition,
  solicitarKycDefinition,
  iniciarOnrampDefinition,
];

export const TOOL_EXECUTORS: Record<string, ToolExecutor> = {
  consultar_perfil: consultarPerfilExecute,
  consultar_tanda: consultarTandaExecute,
  crear_tanda: crearTandaExecute,
  unirse_tanda: unirseTandaExecute,
  aportar_turno: aportarTurnoExecute,
  abrir_disputa: abrirDisputaExecute,
  votar_disputa: votarDisputaExecute,
  solicitar_kyc: solicitarKycExecute,
  iniciar_onramp: iniciarOnrampExecute,
};

export async function executeTool(name: string, args: unknown, context: ToolContext): Promise<ToolResult> {
  const executor = TOOL_EXECUTORS[name];
  if (!executor) {
    return { type: "error", error: `Unknown tool: ${name}` };
  }
  try {
    return await executor(args, context);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { type: "error", error: `Tool ${name} failed: ${message}` };
  }
}
