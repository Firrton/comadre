import { twilioClient } from "./twilioClient.js";

/**
 * Send a free-form WhatsApp text message via Twilio.
 *
 * Only valid within the 24-hour conversation window. Outside that window,
 * use `sendTemplate` with a pre-approved template.
 *
 * @param to E.164 with `whatsapp:` prefix, e.g. `whatsapp:+5218116346072`
 * @param body Plain text body (max 4096 chars)
 */
export async function sendWhatsAppMessage(
  to: string,
  body: string,
): Promise<{ messageSid: string; status: string }> {
  // NOTE: TWILIO_WHATSAPP_FROM removed from schema in PR 1; replaced by OPENWA_* in PR 3.
  const msg = await twilioClient.messages.create({
    from: process.env["TWILIO_WHATSAPP_FROM"] ?? "",
    to,
    body,
  });
  return { messageSid: msg.sid, status: msg.status };
}
