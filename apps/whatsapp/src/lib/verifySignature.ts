import Twilio from "twilio";

interface VerifyArgs {
  authToken: string;
  signature: string;
  url: string;
  params: Record<string, string>;
}

/**
 * Verify the `X-Twilio-Signature` header on an inbound webhook.
 *
 * Twilio signs each request with HMAC-SHA1 of (URL + sorted form params)
 * keyed by the account's Auth Token. If the signature does not match, the
 * request is forged or replayed.
 *
 * NOTE: webhook signature verification REQUIRES the master `TWILIO_AUTH_TOKEN`,
 * NOT an API Key Secret. Twilio always signs with the account auth token.
 */
export function verifyTwilioSignature({
  authToken,
  signature,
  url,
  params,
}: VerifyArgs): boolean {
  if (signature.length === 0) return false;
  if (authToken.length === 0) return false;
  return Twilio.validateRequest(authToken, signature, url, params);
}
