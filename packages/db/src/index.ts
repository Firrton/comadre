/**
 * @comadre/db — public API
 *
 * Re-exports:
 * - All table definitions and enum objects from schema.ts
 * - The db singleton and closeDb() helper from client.ts
 */

// Tables
export {
  users,
  conversations,
  idempotencyKeys,
  ramps,
  kycSessions,
  transfers,
  contactRoutes,
  savingsPositions,
  savingsActions,
  savingsNudges,
  smartWallets,
  sessionKeys,
  authSessions,
  elevatedIntents,
} from "./schema.js";

// Enums (Drizzle pgEnum objects — useful for .notInArray / .inArray helpers)
export {
  kycTierEnum,
  channelEnum,
  savingsProviderEnum,
  savingsPositionStatusEnum,
  savingsActionTypeEnum,
  savingsActionStatusEnum,
  rampDirectionEnum,
  rampStatusEnum,
  kycSessionStatusEnum,
  transferStatusEnum,
  sessionKeyStatusEnum,
  sessionKeyKindEnum,
  authSessionStatusEnum,
  elevatedIntentStatusEnum,
} from "./schema.js";

// Client
export { db, getDb, closeDb } from "./client.js";
