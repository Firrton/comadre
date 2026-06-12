/**
 * WhatsApp JID (Jabber ID) utilities for OpenWA integration.
 *
 * JID format for individual chats: "<country_code><number>@c.us"
 * JID format for groups:           "<number>@g.us"
 * Other known suffixes:            "@broadcast" (status broadcasts)
 *
 * Reference: whatsapp-web.js ContactId format
 */

/**
 * Returns true if the JID represents an individual (non-group) chat.
 *
 * OpenWA uses `@c.us` suffix for individual chats and `@g.us` for groups.
 * The number part must be at least 7 digits (minimum plausible E.164 without +).
 */
export function isIndividualJid(jid: string): boolean {
  if (!jid.endsWith("@c.us")) return false;
  const numberPart = jid.slice(0, -"@c.us".length);
  // Must be all digits, minimum 7 chars, and must NOT start with 0
  // (E.164 country codes never begin with 0; leading-zero JIDs are malformed)
  return /^[1-9]\d{6,}$/.test(numberPart);
}

/**
 * Convert an OpenWA JID to a canonical `whatsapp:+E164` address.
 *
 * Returns null if:
 * - The JID is not an individual chat (group, broadcast, etc.)
 * - The number part is not all-digits or is too short
 *
 * The `+` prefix is mandatory — without it `hashPhone()` and
 * `resolveUserFromPhone()` silently fail to find the user.
 *
 * @example
 * jidToWhatsAppAddress("5491112345678@c.us") // → "whatsapp:+5491112345678"
 * jidToWhatsAppAddress("120363000000000000@g.us") // → null
 * jidToWhatsAppAddress("status@broadcast") // → null
 */
export function jidToWhatsAppAddress(jid: string): string | null {
  if (!isIndividualJid(jid)) return null;
  const numberPart = jid.slice(0, -"@c.us".length);
  return `whatsapp:+${numberPart}`;
}
