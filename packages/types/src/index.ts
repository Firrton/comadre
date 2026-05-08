/**
 * @comadre/types
 *
 * Shared Zod schemas and TypeScript types for the Comadre monorepo.
 * Consumed by: apps/api, apps/whatsapp, apps/indexer, apps/agent,
 *              packages/agent-tools
 *
 * Each exported name is both a Zod schema (runtime value) and a TypeScript
 * type (via `z.infer<typeof Schema>`). Consumers choose:
 *
 *   import { CreateTandaInput } from "@comadre/types";      // runtime schema
 *   import type { CreateTandaInput } from "@comadre/types"; // type only
 */

// --- Inputs (API request bodies) ---
export {
  SolanaPubkey,
  CreateTandaInput,
  JoinTandaInput,
  ContributeInput,
  OpenDisputeInput,
  VoteDisputeInput,
  CreateUserProfileInput,
} from "./inputs.js";

// --- Responses (API response bodies) ---
export {
  MemberResponse,
  TandaResponse,
  UserProfileResponse,
  UnsignedTransactionResponse,
} from "./responses.js";

// Plain types (enums without a Zod schema value at the top level)
export type { KycTier, TandaState } from "./responses.js";

// --- Webhooks (incoming from external services) ---
export {
  SumsubWebhookEvent,
  TwilioInboundWebhook,
  TwilioStatusCallback,
  HeliusWebhookEvent,
  HeliusWebhookPayload,
} from "./webhooks.js";
