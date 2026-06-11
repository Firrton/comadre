import { sendText } from "./openwaClient.js";

// ---------------------------------------------------------------------------
// Address conversion: Comadre canonical → OpenWA chatId
// ---------------------------------------------------------------------------

/**
 * Convert a Comadre canonical WhatsApp address to an OpenWA chatId.
 *   "whatsapp:+5491112345678" → "5491112345678@c.us"
 *
 * Strips the "whatsapp:" prefix (case-insensitive) and the leading "+".
 * The resulting string is the E.164 digit sequence appended with "@c.us".
 */
export function toChatId(to: string): string {
  const digits = to.replace(/^whatsapp:/i, "").replace(/^\+/, "");
  return `${digits}@c.us`;
}

// ---------------------------------------------------------------------------
// sendWhatsAppMessage — public API (stable signature)
// ---------------------------------------------------------------------------

/**
 * Send a free-form WhatsApp text via the OpenWA bridge.
 *
 * @param to   Comadre canonical address: "whatsapp:+E164"
 * @param body Plain text (max 4096 chars)
 * @returns    { messageId, timestamp } on success
 * @throws     OpenWaSendError — caller decides logging vs. surfacing.
 *             Inbound reply path (index.ts) wraps in try/catch → swallows.
 *             /reply handler maps to 502 so nudge caller can retry later.
 */
export async function sendWhatsAppMessage(
  to: string,
  body: string,
): Promise<{ messageId: string; timestamp: number }> {
  return sendText(toChatId(to), body);
}
