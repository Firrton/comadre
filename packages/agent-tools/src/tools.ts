/**
 * The Comadre agent tools.
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

// ───────────────────────────────────────────────────────────────────────────
// PII redaction helpers — minimize PII visible to the LLM context
// ───────────────────────────────────────────────────────────────────────────

function maskWallet(wallet: string | null | undefined): string | null {
  if (!wallet) return null;
  if (wallet.length < 8) return wallet;
  return `...${wallet.slice(-4)}`;
}

function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  // E.164 like +52181... → +52...XX
  if (phone.length < 6) return "***";
  return `${phone.slice(0, 4)}...${phone.slice(-2)}`;
}

function redactSensitiveFields(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  if (typeof data !== "object") return data;
  if (Array.isArray(data)) return data.map(redactSensitiveFields);

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey === "wallet" ||
      lowerKey === "user_wallet" ||
      lowerKey === "userwallet" ||
      lowerKey === "creator_wallet" ||
      lowerKey === "creatorwallet" ||
      lowerKey === "opener_wallet" ||
      lowerKey === "openerwallet" ||
      lowerKey === "voter_wallet" ||
      lowerKey === "voterwallet" ||
      lowerKey === "recipient_wallet" ||
      lowerKey === "recipientwallet" ||
      lowerKey === "sender_wallet" ||
      lowerKey === "senderwallet" ||
      lowerKey === "walletaddress"
    ) {
      out[key] = maskWallet(value as string);
    } else if (
      lowerKey === "phone" ||
      lowerKey === "phone_number" ||
      lowerKey === "phonenumber"
    ) {
      out[key] = maskPhone(value as string);
    } else if (
      lowerKey === "phone_hash" ||
      lowerKey === "phonehash" ||
      lowerKey === "applicant_id" ||
      lowerKey === "applicantid" ||
      lowerKey === "privy_user_id" ||
      lowerKey === "privyuserid" ||
      lowerKey === "secret_key" ||
      lowerKey === "secretkey" ||
      lowerKey === "secret_key_b58" ||
      lowerKey === "secretkeyb58" ||
      lowerKey === "walletid"
    ) {
      // Remove these fields entirely
      continue;
    } else if (typeof value === "object" && value !== null) {
      out[key] = redactSensitiveFields(value);
    } else {
      out[key] = value;
    }
  }
  return out;
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
    userId: context.userId,
  });
  return { type: "data", data: redactSensitiveFields(data), summary: "Perfil cargado" };
};

// --------------------------------------------------------------------------
// 2. solicitar_kyc
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
    userId: context.userId,
    idempotencyKey,
  });
  return { type: "data", data: redactSensitiveFields(data), summary: "Sesión KYC iniciada" };
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
    body: { fiat_currency, fiat_amount_cents: amount_cents, user_wallet: context.userId },
    userId: context.userId,
    idempotencyKey,
  });
  const dollars = (amount_cents / 100).toFixed(2);
  return { type: "data", data: redactSensitiveFields(data), summary: `Cotización on-ramp para ${fiat_currency} ${dollars}` };
};

// --------------------------------------------------------------------------
// 2. consultar_balance
export const consultarBalanceDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "consultar_balance",
    description:
      "Consulta el saldo actual del usuario (USDC + stats). Usa esta tool antes de iniciar una transferencia para verificar si tiene suficiente.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
};
export const consultarBalanceExecute: ToolExecutor = async (_args, context) => {
  const data = await apiCall<unknown>({
    method: "GET",
    path: "/api/v1/wallet/balance",
    userId: context.userId,
  });
  return { type: "data", data: redactSensitiveFields(data), summary: "Saldo USDC consultado" };
};

// iniciar_onboarding (legacy Solana onboarding) — removed in Monad migration.
// Use iniciar_cuenta_segura instead.

// --------------------------------------------------------------------------
// 15. iniciar_cuenta_segura (Monad onboarding via magic link / SMS)
// --------------------------------------------------------------------------
export const iniciarCuentaSeguraDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "iniciar_cuenta_segura",
    description:
      "Inicia el proceso de creación de cuenta segura para el usuario en Monad. El agente envía un link único por SMS al teléfono del usuario; el usuario hace tap, confirma con un código que le llega y vuelve a WhatsApp. Usar ESTE tool en lugar de iniciar_onboarding para usuarios NUEVOS desde la migración a Monad.",
    // telefono is intentionally NOT in the schema — it is server-injected from
    // context.senderPhone so the LLM cannot spoof a different phone number.
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
};
export const iniciarCuentaSeguraExecute: ToolExecutor = async (_args, context) => {
  const telefono = context.senderPhone;
  if (!telefono) {
    return {
      type: "error",
      error: "iniciar_cuenta_segura requires senderPhone in context",
    };
  }
  try {
    const data = await apiCall<{ ok: true; magicLink?: string }>({
      method: "POST",
      path: "/api/v1/onboarding/monad/start",
      userId: "",
      idempotencyKey: newIdempotencyKey(),
      body: { phone: telefono },
    });
    const summary = data.magicLink
      ? `Listo, te paso el link de seguridad — abrílo, confirmá con el código por SMS y volvés acá: ${data.magicLink}`
      : "Listo, ya te mandé un SMS con el link. Abrílo en el celu, confirmá con el código y volvés a esta charla.";
    return { type: "data", data: redactSensitiveFields(data), summary };
  } catch {
    return { type: "error", error: "Tuve un problema arrancando tu cuenta. ¿Probamos de nuevo en un minuto?" };
  }
};

// --------------------------------------------------------------------------
// 16. enviar_plata (Monad single-step USDC transfer via session key)
// --------------------------------------------------------------------------
export const enviarPlataDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "enviar_plata",
    description:
      "Envía USDC al WhatsApp del destinatario usando la cuenta Monad del usuario. Llamar SOLO después de que el usuario haya confirmado EXPLÍCITAMENTE el monto y el destinatario en el chat (ej: 'sí, mandalo'). El límite es 50 USDC por operación — para montos mayores hay que pasar por confirmación por SMS aparte (no implementado en este tool). El contrato on-chain rechaza cualquier intento por encima del límite.",
    parameters: {
      type: "object",
      properties: {
        to_phone: {
          type: "string",
          description: "Destinatario en E.164 (ej. +5491112345678).",
        },
        amount_usdc: {
          type: "string",
          description: "Monto en USDC como string decimal (hasta 6 decimales).",
        },
        note: {
          type: "string",
          maxLength: 280,
          description: "Nota opcional para el destinatario.",
        },
      },
      required: ["to_phone", "amount_usdc"],
    },
  },
};

interface EnviarPlataArgs {
  to_phone: string;
  amount_usdc: string;
  note?: string;
}

export const enviarPlataExecute: ToolExecutor = async (args, context) => {
  const a = args as EnviarPlataArgs;
  try {
    const data = await apiCall<{
      ok: true;
      needsConfirmation?: boolean;
      confirmationPrompt?: string;
      deferred: boolean;
      transferId: string;
      txHash?: string;
      amountUsdc: string;
      message?: string;
    }>({
      method: "POST",
      path: "/api/v1/transfers-monad",
      userId: "",
      idempotencyKey: context.idempotencyKey ?? newIdempotencyKey(),
      body: {
        senderPhone: context.senderPhone,
        toPhone: a.to_phone,
        amountUsdc: a.amount_usdc,
        ...(a.note ? { note: a.note } : {}),
      },
    });
    if (data.needsConfirmation && data.confirmationPrompt) {
      return {
        type: "confirmation",
        confirmationPrompt: data.confirmationPrompt,
        data: redactSensitiveFields(data),
      };
    }
    const summary = data.deferred
      ? `El contacto no tiene cuenta todavía. Le mandé un aviso por WhatsApp; cuando se registre, recibe los ${a.amount_usdc} USDC.`
      : `Mandé ${a.amount_usdc} USDC ✅`;
    return { type: "data", data: redactSensitiveFields(data), summary };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/daily_cap_exceeded|DAILY_CAP_EXCEEDED/i.test(message)) {
      return {
        type: "error",
        error: message.includes("límite diario")
          ? message
          : "Superaste el límite diario de transferencias. Podés volver a enviar mañana.",
      };
    }
    if (/cap_exceeded|CAP_EXCEEDED/i.test(message)) {
      return {
        type: "error",
        error: "Esa cantidad supera el límite por operación (50 USDC). Para más grande te paso un código por SMS, pero esa función todavía no está lista.",
      };
    }
    if (/no_session|NO_SESSION/i.test(message)) {
      return {
        type: "error",
        error: "Tu sesión expiró. Llamá a `iniciar_cuenta_segura` para renovarla.",
      };
    }
    if (/sender_not_onboarded|SENDER_NOT_ONBOARDED/i.test(message)) {
      return {
        type: "error",
        error: "Todavía no tenés cuenta. Te paso `iniciar_cuenta_segura` para crearla.",
      };
    }
    return { type: "error", error: "No pude completar la transferencia. ¿Probamos de nuevo?" };
  }
};

// --------------------------------------------------------------------------
// Guardadito tools — user-facing savings flow
// --------------------------------------------------------------------------

export const consultarGuardaditoDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "consultar_guardadito",
    description:
      "Consulta el Guardadito del usuario: USDC disponible, USDC guardado, y sugerencia segura. Usá lenguaje simple; no digas staking/yield/vault.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
};
export const consultarGuardaditoExecute: ToolExecutor = async (_args, context) => {
  const data = await apiCall<{
    available: { usdc: string };
    saved: { usdc: string };
    suggested: { shouldSuggest: boolean; amountUsdc: string; liquidReserveUsdc: string };
    copy: { short: string; risk: string };
  }>({
    method: "GET",
    path: "/api/v1/savings/summary",
    userId: context.userId,
  });
  return {
    type: "data",
    data: redactSensitiveFields(data),
    summary: data.suggested.shouldSuggest
      ? `Puede sugerirse Guardadito por ${data.suggested.amountUsdc} USDC, dejando ${data.suggested.liquidReserveUsdc} USDC disponibles.`
      : `Guardadito consultado: disponible ${data.available.usdc} USDC, guardado ${data.saved.usdc} USDC.`,
  };
};

export const prepararGuardaditoDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "preparar_guardadito",
    description:
      "Prepara guardar USDC en el Guardadito. SOLO llamá después de que el usuario acepte y diga el monto. Después pedí confirmación explícita antes de confirmar_guardadito.",
    parameters: {
      type: "object",
      properties: {
        amount_usdc: {
          type: "string",
          description: "Monto en USDC como string decimal con hasta 6 decimales. Ej: '30'.",
        },
      },
      required: ["amount_usdc"],
      additionalProperties: false,
    },
  },
};
export const prepararGuardaditoExecute: ToolExecutor = async (args, context) => {
  const { amount_usdc } = args as { amount_usdc: string };
  const idempotencyKey = context.idempotencyKey ?? newIdempotencyKey();
  const data = await apiCall<{
    actionId: string;
    amount: { usdc: string };
    status: "pending";
    summary: string;
  }>({
    method: "POST",
    path: "/api/v1/savings/deposits",
    body: { amountUsdc: amount_usdc },
    userId: context.userId,
    idempotencyKey,
  });
  return {
    type: "data",
    data: redactSensitiveFields(data),
    summary: `Guardadito preparado por ${data.amount.usdc} USDC. Pedí confirmación antes de llamar confirmar_guardadito.`,
  };
};

export const confirmarGuardaditoDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "confirmar_guardadito",
    description:
      "Confirma una acción de Guardadito pendiente. SOLO llamá si el usuario dijo 'sí', 'confirmo' o 'dale' explícitamente.",
    parameters: {
      type: "object",
      properties: {
        action_id: { type: "string", description: "UUID devuelto por preparar_guardadito o retirar_guardadito." },
      },
      required: ["action_id"],
      additionalProperties: false,
    },
  },
};
export const confirmarGuardaditoExecute: ToolExecutor = async (args, context) => {
  const { action_id } = args as { action_id: string };
  const idempotencyKey = context.idempotencyKey ?? newIdempotencyKey();
  const data = await apiCall<{ actionId: string; status: "confirmed"; explorerUrl?: string }>({
    method: "POST",
    path: `/api/v1/savings/actions/${encodeURIComponent(action_id)}/confirm`,
    body: {},
    userId: context.userId,
    idempotencyKey,
  });
  return {
    type: "data",
    data: redactSensitiveFields(data),
    summary: data.explorerUrl
      ? `Guardadito confirmado. Tx: ${data.explorerUrl}`
      : "Guardadito confirmado.",
  };
};

export const retirarGuardaditoDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "retirar_guardadito",
    description:
      "Prepara retirar USDC del Guardadito. SOLO llamá cuando el usuario pida sacar un monto. Después pedí confirmación explícita.",
    parameters: {
      type: "object",
      properties: {
        amount_usdc: {
          type: "string",
          description: "Monto en USDC como string decimal con hasta 6 decimales. Ej: '10'.",
        },
      },
      required: ["amount_usdc"],
      additionalProperties: false,
    },
  },
};
export const retirarGuardaditoExecute: ToolExecutor = async (args, context) => {
  const { amount_usdc } = args as { amount_usdc: string };
  const idempotencyKey = context.idempotencyKey ?? newIdempotencyKey();
  const data = await apiCall<{ actionId: string; amount: { usdc: string }; status: "pending" }>({
    method: "POST",
    path: "/api/v1/savings/withdrawals",
    body: { amountUsdc: amount_usdc },
    userId: context.userId,
    idempotencyKey,
  });
  return {
    type: "data",
    data: redactSensitiveFields(data),
    summary: `Retiro del Guardadito preparado por ${data.amount.usdc} USDC. Pedí confirmación antes de llamar confirmar_guardadito.`,
  };
};

export const cancelarGuardaditoDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "cancelar_guardadito",
    description:
      "Cancela una acción de Guardadito pendiente cuando el usuario dice no, cancelar o cambia de opinión.",
    parameters: {
      type: "object",
      properties: {
        action_id: { type: "string", description: "UUID de la acción pendiente." },
      },
      required: ["action_id"],
      additionalProperties: false,
    },
  },
};
export const cancelarGuardaditoExecute: ToolExecutor = async (args, context) => {
  const { action_id } = args as { action_id: string };
  const idempotencyKey = context.idempotencyKey ?? newIdempotencyKey();
  const data = await apiCall<{ actionId: string; status: "cancelled" }>({
    method: "POST",
    path: `/api/v1/savings/actions/${encodeURIComponent(action_id)}/cancel`,
    body: {},
    userId: context.userId,
    idempotencyKey,
  });
  return { type: "data", data: redactSensitiveFields(data), summary: "Acción de Guardadito cancelada." };
};

// --------------------------------------------------------------------------
// 22. confirmar_codigo_seguridad — OTP escalation confirmation
// --------------------------------------------------------------------------
export const confirmarCodigoSeguridadDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "confirmar_codigo_seguridad",
    description:
      "Cuando el usuario te pasa un código que recibió por SMS para confirmar una operación grande, llamá esta tool. Args: intent_id (devuelto por la operación anterior) + code (lo que el usuario te dijo).",
    parameters: {
      type: "object",
      properties: {
        intent_id: {
          type: "string",
          description: "ID del intent pendiente (devuelto por enviar_plata cuando excede el cap).",
        },
        code: {
          type: "string",
          description: "Código de 4-8 dígitos que el usuario recibió por SMS.",
        },
      },
      required: ["intent_id", "code"],
      additionalProperties: false,
    },
  },
};

export const confirmarCodigoSeguridadExecute: ToolExecutor = async (args, context) => {
  const { intent_id, code } = args as { intent_id: string; code: string };
  const data = await apiCall<unknown>({
    method: "POST",
    path: `/api/v1/elevated-intents/${encodeURIComponent(intent_id)}/confirm`,
    body: { code },
    userId: context.userId,
    idempotencyKey: newIdempotencyKey(),
  });
  return {
    type: "data",
    data: redactSensitiveFields(data),
    summary: "Código verificado y operación confirmada",
  };
};

// --------------------------------------------------------------------------
// Registry
// --------------------------------------------------------------------------
// Removed (dead endpoints — no route mounted in apps/api):
//   - consultar_tanda, crear_tanda, unirse_tanda, aportar_turno, abrir_disputa,
//     votar_disputa, mis_tandas  → /api/v1/tandas/* (tandas router excised)
//   - iniciar_transfer, confirmar_transfer, cancelar_transfer → /api/v1/transfers (Solana path excised)
// `iniciar_onboarding` (legacy Solana onboarding) was already removed — was
// creating plaintext Solana keys in DB. `iniciar_cuenta_segura` (Monad + KMS
// session keys) is the replacement. See audit COM-032 / COM-005.
export const ALL_TOOLS: readonly ToolDefinition[] = [
  consultarPerfilDefinition,
  solicitarKycDefinition,
  iniciarOnrampDefinition,
  consultarBalanceDefinition,
  iniciarCuentaSeguraDefinition,
  enviarPlataDefinition,
  consultarGuardaditoDefinition,
  prepararGuardaditoDefinition,
  confirmarGuardaditoDefinition,
  retirarGuardaditoDefinition,
  cancelarGuardaditoDefinition,
  confirmarCodigoSeguridadDefinition,
];

export const TOOL_EXECUTORS: Record<string, ToolExecutor> = {
  consultar_perfil: consultarPerfilExecute,
  solicitar_kyc: solicitarKycExecute,
  iniciar_onramp: iniciarOnrampExecute,
  consultar_balance: consultarBalanceExecute,
  iniciar_cuenta_segura: iniciarCuentaSeguraExecute,
  enviar_plata: enviarPlataExecute,
  consultar_guardadito: consultarGuardaditoExecute,
  preparar_guardadito: prepararGuardaditoExecute,
  confirmar_guardadito: confirmarGuardaditoExecute,
  retirar_guardadito: retirarGuardaditoExecute,
  cancelar_guardadito: cancelarGuardaditoExecute,
  confirmar_codigo_seguridad: confirmarCodigoSeguridadExecute,
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
