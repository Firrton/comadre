import type { Hex } from "viem";
import { decodeUsdcTransferCalldata } from "./monadUsdcTransfer.js";

export type RecipientPolicyResult =
  | { ok: true }
  | { ok: false; reason: "recipient_not_allowed" | "undecodable_calldata" };

export type ConfirmationParseResult = "affirmative" | "negative" | "ambiguous";

const AFFIRMATIVE_WORDS = new Set(["sí", "si", "dale", "ok", "confirmo", "yes"]);
const NEGATIVE_WORDS = new Set(["no", "cancelar", "cancela", "cancelá"]);

export function evaluateRecipient(
  allowedRecipients: string[],
  calldata: Hex | string,
): RecipientPolicyResult {
  const decoded = decodeUsdcTransferCalldata(calldata as Hex);
  if (!decoded) {
    return { ok: false, reason: "undecodable_calldata" };
  }

  const recipient = decoded.to.toLowerCase();
  const allowed = new Set(allowedRecipients.map((address) => address.toLowerCase()));

  if (!allowed.has(recipient)) {
    return { ok: false, reason: "recipient_not_allowed" };
  }

  return { ok: true };
}

export function parseConfirmation(message: string): ConfirmationParseResult {
  const trimmed = message.trim().toLowerCase();
  if (!trimmed) return "ambiguous";

  const tokens = trimmed.match(/[\p{L}\p{M}]+|✅|❌/gu) ?? [];
  if (tokens.length !== 1) return "ambiguous";

  const [token] = tokens;
  if (token === "✅" || (token && AFFIRMATIVE_WORDS.has(token))) return "affirmative";
  if (token === "❌" || (token && NEGATIVE_WORDS.has(token))) return "negative";

  return "ambiguous";
}

export function buildConfirmationPrompt(recipientPhone: string, amountUsdc: string): string {
  return `Es la primera vez que enviás a ${recipientPhone}. ¿Confirmás enviar ${amountUsdc} USDC? Respondé SÍ para confirmar o NO para cancelar.`;
}

export function buildConfirmationReprompt(recipientPhone: string, amountUsdc: string): string {
  return `Tenés un envío pendiente de ${amountUsdc} USDC a ${recipientPhone}. Respondé SÍ o NO.`;
}

export function buildConfirmationSuccessReply(recipientPhone: string, amountUsdc: string): string {
  return `Listo, envié ${amountUsdc} USDC a ${recipientPhone}.`;
}
