/**
 * Normalize a phone number to canonical E.164 (carrier form).
 * Handles WhatsApp-specific quirks:
 *   - MX: +52 1 XXXXXXXXXX → +52 XXXXXXXXXX
 *   - AR: +54 9 XXXXXXXXXX → +54 XXXXXXXXXX
 */
export function normalizePhoneE164(input: string): string {
  if (!input.startsWith("+")) return input;
  if (/^\+521\d{10}$/.test(input)) return `+52${input.slice(4)}`;
  if (/^\+549\d{10}$/.test(input)) return `+54${input.slice(4)}`;
  return input;
}
