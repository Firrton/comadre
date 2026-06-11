import Twilio from "twilio";

// NOTE: Twilio env vars were removed from the global env schema in PR 1.
// This file and its consumer (sendMessage.ts) are fully replaced in PR 3.
// Read directly from process.env to keep compilation passing during the PR 1→3 transition.
// These values will be undefined at runtime (intentional — this code path is unused after PR 3).

/**
 * @deprecated Will be deleted in PR 3 (openwa-outbound-bootstrap).
 * Singleton Twilio REST client — kept for compile-time compat only.
 */
export const twilioClient: Twilio.Twilio = Twilio(
  process.env["TWILIO_API_KEY_SID"] ?? "",
  process.env["TWILIO_API_KEY_SECRET"] ?? "",
  { accountSid: process.env["TWILIO_ACCOUNT_SID"] ?? "" },
);
