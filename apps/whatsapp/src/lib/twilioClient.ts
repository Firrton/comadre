import Twilio from "twilio";

import { env } from "@comadre/config";

/**
 * Singleton Twilio REST client.
 *
 * Uses API Key SID + Secret (scoped) for outbound auth instead of the master
 * Auth Token. The Account SID is passed as the third argument so resource
 * URLs include `/Accounts/{ACCOUNT_SID}/...`.
 */
export const twilioClient: Twilio.Twilio = Twilio(
  env.TWILIO_API_KEY_SID,
  env.TWILIO_API_KEY_SECRET,
  { accountSid: env.TWILIO_ACCOUNT_SID },
);
