import type { Hex } from "viem";
import { decodeUsdcTransferCalldata } from "./monadUsdcTransfer.js";

export type RecipientPolicyResult =
  | { ok: true }
  | { ok: false; reason: "recipient_not_allowed" | "undecodable_calldata" };

export type { ConfirmationParseResult } from "@comadre/types";

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

export { parseConfirmation } from "@comadre/types";

export function buildConfirmationPrompt(recipientPhone: string, amountUsdc: string): string {
  return `Es la primera vez que enviás a ${recipientPhone}. ¿Confirmás enviar ${amountUsdc} USDC? Respondé SÍ para confirmar o NO para cancelar.`;
}

export function buildConfirmationReprompt(recipientPhone: string, amountUsdc: string): string {
  return `Tenés un envío pendiente de ${amountUsdc} USDC a ${recipientPhone}. Respondé SÍ o NO.`;
}

export function buildConfirmationSuccessReply(recipientPhone: string, amountUsdc: string): string {
  return `Listo, envié ${amountUsdc} USDC a ${recipientPhone}.`;
}
