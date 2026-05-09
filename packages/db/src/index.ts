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
} from "./schema.js";

// Enums (Drizzle pgEnum objects — useful for .notInArray / .inArray helpers)
export {
  kycTierEnum,
  tandaStateEnum,
  payoutOrderEnum,
  disputeStateEnum,
  badgeTypeEnum,
  channelEnum,
  rampDirectionEnum,
  rampStatusEnum,
  loanStateEnum,
  kycSessionStatusEnum,
  transferStatusEnum,
} from "./schema.js";

// Client
export { db, getDb, closeDb } from "./client.js";
