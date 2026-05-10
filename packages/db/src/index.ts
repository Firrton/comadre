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
  userKeypairs,
  tandas,
  members,
  disputes,
  disputeVotes,
  loans,
  loanCosigners,
  badges,
  conversations,
  idempotencyKeys,
  ramps,
  kycSessions,
  transfers,
  contactRoutes,
  savingsPositions,
  savingsActions,
  savingsNudges,
} from "./schema.js";

// Enums (Drizzle pgEnum objects — useful for .notInArray / .inArray helpers)
export {
  kycTierEnum,
  tandaStateEnum,
  payoutOrderEnum,
  disputeStateEnum,
  badgeTypeEnum,
  channelEnum,
  savingsProviderEnum,
  savingsPositionStatusEnum,
  savingsActionTypeEnum,
  savingsActionStatusEnum,
  rampDirectionEnum,
  rampStatusEnum,
  loanStateEnum,
  kycSessionStatusEnum,
  transferStatusEnum,
} from "./schema.js";

// Client
export { db, getDb, closeDb } from "./client.js";
