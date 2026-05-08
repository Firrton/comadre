/**
 * WhatsApp stub — logs what *would* be sent via apps/whatsapp /reply.
 *
 * Replace with an HTTP call to `env.WA_URL + "/reply"` once the other
 * agent's apps/whatsapp service is merged into main.
 */

import { logger } from "./logger.js";

export async function sendTemplate(
  phoneE164: string,
  templateName: string,
  params: Record<string, string>
): Promise<void> {
  logger.info(
    { stub: true, phoneE164, templateName, params },
    `[stub] WA template "${templateName}" -> ${phoneE164}`
  );
}
