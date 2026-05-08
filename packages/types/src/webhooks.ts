/**
 * @comadre/types — Webhook payload schemas (incoming from external services)
 *
 * These schemas validate the raw POST body that external services send to
 * our webhook endpoints. Strict parsing ensures bad payloads fail loudly
 * at the boundary rather than propagating malformed data into the system.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Sumsub (KYC) webhooks
// Docs: https://docs.sumsub.com/reference/webhook-types
// ---------------------------------------------------------------------------

/**
 * Possible review answers for a completed applicant review.
 * GREEN = passed KYC, RED = failed (rejected or fraudulent).
 */
const SumsubReviewAnswer = z.enum(["GREEN", "RED"]);

/**
 * Rejection labels when reviewAnswer is RED.
 * Non-exhaustive — we capture the most common ones; unknown strings pass.
 */
const SumsubRejectType = z.enum([
  "FINAL",
  "RETRY",
]).optional();

const SumsubReviewResult = z.object({
  reviewAnswer: SumsubReviewAnswer,
  rejectLabels: z.array(z.string()).optional(),
  reviewRejectType: SumsubRejectType,
  clientComment: z.string().optional(),
  moderationComment: z.string().optional(),
});

/**
 * Fields common to all Sumsub webhook event types.
 */
const SumsubBaseEvent = z.object({
  /** Sumsub internal applicant ID */
  applicantId: z.string(),
  /**
   * Our own user identifier passed during SDK init — typically the user's
   * Solana wallet address or internal UUID.
   */
  externalUserId: z.string(),
  /** Sumsub verification level name (e.g. "basic-kyc-level") */
  levelName: z.string(),
  /** ISO 8601 timestamp of when the event was created */
  createdAt: z.string(),
  /** Sumsub inspection ID, useful for retrieving documents */
  inspectionId: z.string().optional(),
  /** Detected country code (ISO 3166-1 alpha-2) */
  applicantType: z.string().optional(),
  sandboxMode: z.boolean().optional(),
});

/**
 * Discriminated union of Sumsub webhook event types.
 * Each branch includes only the fields relevant to that event type.
 *
 * Note: We model this as a discriminated union on `type` so consuming
 * services can narrow without manual type guards:
 *   if (event.type === "applicantReviewed") { event.reviewResult ... }
 */
export const SumsubWebhookEvent = z.discriminatedUnion("type", [
  SumsubBaseEvent.extend({
    type: z.literal("applicantReviewed"),
    /** Present when KYC review is complete */
    reviewResult: SumsubReviewResult,
  }),
  SumsubBaseEvent.extend({
    type: z.literal("applicantPending"),
    /** Review started but not yet concluded */
    reviewResult: SumsubReviewResult.partial().optional(),
  }),
  SumsubBaseEvent.extend({
    type: z.literal("applicantOnHold"),
    /** Manual review required */
    reviewResult: SumsubReviewResult.partial().optional(),
  }),
  SumsubBaseEvent.extend({
    type: z.literal("applicantActionPending"),
    /** The applicant needs to take a new action (re-submit docs, etc.) */
    reviewResult: SumsubReviewResult.partial().optional(),
  }),
]);
export type SumsubWebhookEvent = z.infer<typeof SumsubWebhookEvent>;

// ---------------------------------------------------------------------------
// Meta WhatsApp Business webhooks
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks
// ---------------------------------------------------------------------------

/** WhatsApp message types we handle; others are silently ignored downstream */
const WaMessageType = z.enum([
  "text",
  "audio",
  "image",
  "document",
  "button",
  "interactive",
  "sticker",
  "reaction",
  "unsupported",
]);

const WaTextBody = z.object({
  body: z.string(),
});

const WaAudioBody = z.object({
  id: z.string(),
  mime_type: z.string().optional(),
});

const WaButtonBody = z.object({
  payload: z.string(),
  text: z.string(),
});

const WaInteractiveBody = z.object({
  type: z.enum(["button_reply", "list_reply"]),
  button_reply: z
    .object({ id: z.string(), title: z.string() })
    .optional(),
  list_reply: z
    .object({ id: z.string(), title: z.string(), description: z.string().optional() })
    .optional(),
});

/** A single incoming WhatsApp message */
const WaMessage = z.object({
  from: z.string(),
  id: z.string(),
  timestamp: z.string(),
  type: WaMessageType,
  text: WaTextBody.optional(),
  audio: WaAudioBody.optional(),
  button: WaButtonBody.optional(),
  interactive: WaInteractiveBody.optional(),
  context: z
    .object({ from: z.string(), id: z.string() })
    .optional(),
});

/** Contact profile attached to incoming messages */
const WaContact = z.object({
  profile: z.object({ name: z.string() }),
  wa_id: z.string(),
});

/** Delivery / read status update */
const WaStatus = z.object({
  id: z.string(),
  recipient_id: z.string(),
  status: z.enum(["sent", "delivered", "read", "failed"]),
  timestamp: z.string(),
  errors: z
    .array(
      z.object({
        code: z.number(),
        title: z.string(),
        message: z.string().optional(),
        error_data: z
          .object({ details: z.string() })
          .optional(),
      })
    )
    .optional(),
});

const WaChangeValue = z.object({
  messaging_product: z.literal("whatsapp"),
  metadata: z.object({
    display_phone_number: z.string(),
    phone_number_id: z.string(),
  }),
  messages: z.array(WaMessage).optional(),
  contacts: z.array(WaContact).optional(),
  statuses: z.array(WaStatus).optional(),
  errors: z
    .array(z.object({ code: z.number(), title: z.string() }))
    .optional(),
});

/**
 * Top-level Meta WhatsApp Business webhook payload.
 * Sent to POST /webhooks/whatsapp.
 */
export const MetaWhatsAppWebhookEvent = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z.array(
    z.object({
      id: z.string(),
      changes: z.array(
        z.object({
          value: WaChangeValue,
          field: z.string(),
        })
      ),
    })
  ),
});
export type MetaWhatsAppWebhookEvent = z.infer<typeof MetaWhatsAppWebhookEvent>;

// ---------------------------------------------------------------------------
// Helius enhanced transaction webhooks
// Docs: https://docs.helius.dev/webhooks-and-websockets/enhanced-webhooks
// ---------------------------------------------------------------------------

/**
 * Token balance change in an account (subset of Helius enhanced tx schema).
 */
const HeliusTokenTransfer = z.object({
  fromUserAccount: z.string().optional(),
  toUserAccount: z.string().optional(),
  fromTokenAccount: z.string().optional(),
  toTokenAccount: z.string().optional(),
  tokenAmount: z.number(),
  mint: z.string(),
  tokenStandard: z.string().optional(),
});

const HeliusNativeTransfer = z.object({
  fromUserAccount: z.string(),
  toUserAccount: z.string(),
  amount: z.number(),
});

const HeliusAccountData = z.object({
  account: z.string(),
  nativeBalanceChange: z.number(),
  tokenBalanceChanges: z.array(
    z.object({
      userAccount: z.string(),
      tokenAccount: z.string(),
      mint: z.string(),
      rawTokenAmount: z.object({
        tokenAmount: z.string(),
        decimals: z.number(),
      }),
    })
  ),
});

const HeliusInstruction = z.object({
  accounts: z.array(z.string()),
  data: z.string(),
  programId: z.string(),
  innerInstructions: z
    .array(
      z.object({
        accounts: z.array(z.string()),
        data: z.string(),
        programId: z.string(),
      })
    )
    .optional(),
});

/**
 * Single enhanced webhook transaction from Helius.
 * Helius sends an array of these as the POST body.
 * Schema covers the fields our indexer needs; extras pass through unknown().
 *
 * txType reflects the Helius classification enum — we accept any string
 * since Helius may add new types without our schema update.
 */
export const HeliusWebhookEvent = z
  .object({
    /** Helius-classified transaction type (e.g. "TRANSFER", "NFT_SALE") */
    type: z.string(),
    txType: z.string(),
    /** Solana tx signature (base58) */
    signature: z.string(),
    /** Slot the tx was confirmed in */
    slot: z.number().int(),
    /** Unix timestamp (seconds) of block confirmation */
    timestamp: z.number().int(),
    /** Transaction fee in lamports */
    fee: z.number().int(),
    /** Fee-payer wallet address */
    feePayer: z.string(),
    accountData: z.array(HeliusAccountData).optional(),
    tokenTransfers: z.array(HeliusTokenTransfer).optional(),
    nativeTransfers: z.array(HeliusNativeTransfer).optional(),
    instructions: z.array(HeliusInstruction).optional(),
    /** Base64-encoded transaction for re-parsing if needed */
    transactionError: z.unknown().nullable().optional(),
    description: z.string().optional(),
    source: z.string().optional(),
  })
  .passthrough(); // allow extra Helius fields without schema churn

export type HeliusWebhookEvent = z.infer<typeof HeliusWebhookEvent>;

/**
 * Helius sends an array of transactions per webhook call.
 */
export const HeliusWebhookPayload = z.array(HeliusWebhookEvent);
export type HeliusWebhookPayload = z.infer<typeof HeliusWebhookPayload>;
