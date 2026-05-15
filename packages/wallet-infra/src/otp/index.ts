import twilio from "twilio";

let _client: ReturnType<typeof twilio> | null = null;

function getClient() {
  if (_client !== null) return _client;
  const sid = process.env["TWILIO_ACCOUNT_SID"];
  const token = process.env["TWILIO_AUTH_TOKEN"];
  if (!sid || !token) {
    throw new Error("[wallet-infra/otp] TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required");
  }
  _client = twilio(sid, token);
  return _client;
}

function getServiceSid() {
  const sid = process.env["TWILIO_VERIFY_SERVICE_SID"];
  if (!sid) throw new Error("[wallet-infra/otp] TWILIO_VERIFY_SERVICE_SID is required");
  return sid;
}

/**
 * Trigger an OTP delivery via Twilio Verify (SMS).
 * Returns the Verify SID — keep it server-side to bind to the elevated intent.
 */
export async function startOtp(phoneE164: string): Promise<{ verifySid: string; status: string }> {
  const verification = await getClient()
    .verify.v2.services(getServiceSid())
    .verifications.create({ to: phoneE164, channel: "sms" });
  return { verifySid: verification.sid, status: verification.status };
}

export interface OtpCheckResult {
  approved: boolean;
  status: string;
}

/**
 * Check a user-supplied OTP code against the Twilio Verify service.
 * `approved` is true iff `status === "approved"`.
 */
export async function checkOtp(phoneE164: string, code: string): Promise<OtpCheckResult> {
  const check = await getClient()
    .verify.v2.services(getServiceSid())
    .verificationChecks.create({ to: phoneE164, code });
  return { approved: check.status === "approved", status: check.status };
}
