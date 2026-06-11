/**
 * OpenWA inbound webhook schemas and signature verification.
 *
 * V2 FINDING (verified from upstream source, sha256=0fbee7fbee9d746050a20c57544bf7bbb80e65d2):
 * X-OpenWA-Signature format is "sha256=<hex>" (GitHub-style, NOT plain hex).
 * The signed bytes are JSON.stringify(payload) as delivered, NOT raw HTTP body bytes.
 *
 * Source: src/modules/webhook/webhook.service.ts:356-360
 *   return `sha256=${hmac.digest('hex')}`;
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

/**
 * Schema for the `data` field of an OpenWA "message.received" event.
 *
 * Fields match IncomingMessage from the upstream whatsapp-web.js engine interface.
 * `.passthrough()` ensures unknown fields (media, quotedMessage, etc.) survive
 * logging and future-proofing without a schema bump.
 */
export const openWaMessageData = z
  .object({
    id: z.string().min(1),              // msg.id._serialized — dedup key
    from: z.string().min(1),            // "5491112345678@c.us"
    to: z.string().optional(),          // session's own JID (self-loop guard)
    chatId: z.string().optional(),
    body: z.string().default(""),       // text content; "" for non-text types
    type: z.string().optional(),        // "chat" for text messages
    fromMe: z.boolean().default(false),
    isGroup: z.boolean().default(false),
  })
  .passthrough();                       // keep media/quotedMessage/etc.

/**
 * Top-level OpenWA webhook payload envelope.
 *
 * The `event` field in the body is advisory; the `X-OpenWA-Event` request header
 * is authoritative for routing. Both are accepted.
 */
export const openWaEnvelope = z
  .object({
    event: z.string().optional(),
    sessionId: z.string().optional(),
    idempotencyKey: z.string().optional(),
    data: openWaMessageData,
  })
  .passthrough();

export type OpenWaEnvelope = z.infer<typeof openWaEnvelope>;
export type OpenWaMessageData = z.infer<typeof openWaMessageData>;

/**
 * Verify the X-OpenWA-Signature header against the raw request body string.
 *
 * OpenWA sends the signature as "sha256=<hex>" (GitHub-style prefix).
 * The signed bytes are the stringified JSON payload body as received.
 *
 * Fail-closed: returns false when secret is missing, signature is absent,
 * or the "sha256=" prefix is not present. The HMAC bypass in test mode is
 * controlled by the CALLER (NODE_ENV === "test") — NOT here — so this
 * function always exercises real crypto in unit tests.
 *
 * @param args.secret       OPENWA_WEBHOOK_SECRET (at least 32 chars)
 * @param args.signature    X-OpenWA-Signature header value (e.g. "sha256=abc…")
 * @param args.rawBody      The raw JSON body string exactly as received
 */
export function verifyOpenWaSignature(args: {
  secret: string;
  signature: string;
  rawBody: string;
}): boolean {
  if (args.secret.length === 0) return false;
  if (args.signature.length === 0) return false;
  // Format is "sha256=<hex>"; plain hex without the prefix is rejected
  if (!args.signature.startsWith("sha256=")) return false;

  const sigHex = args.signature.slice("sha256=".length);
  const expected = createHmac("sha256", args.secret)
    .update(args.rawBody)
    .digest("hex");

  const a = Buffer.from(sigHex, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
