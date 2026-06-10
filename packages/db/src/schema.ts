/**
 * @comadre/db — Drizzle ORM schema (Monad-only, UUID identity)
 *
 * Tables: users, smart_wallets, session_keys, auth_sessions, elevated_intents,
 * conversations, idempotency_keys, ramps, kyc_sessions, transfers,
 * contact_routes, savings_positions, savings_actions, savings_nudges.
 *
 * Design decisions:
 * - users.id is a surrogate UUID (random). Primary identity anchor.
 * - users.owner_address (Privy EVM wallet, lowercase 0x) is the auth lookup key.
 * - EVM addresses stored as TEXT, lowercase hex `0x...`.
 * - u256 on-chain amounts stored as BIGINT with mode:'bigint' — native BigInt,
 *   no IEEE 754 precision loss.
 * - Timestamps with timezone, mode:'date' — returns JS Date objects.
 * - Enums are Postgres native pgEnum — enforced at the DB level.
 *
 * Known gaps:
 * - `session_keys.permissionId` is empty at install time (audit COM-033).
 *   The on-chain `uninstallValidator(permissionId)` revocation path is
 *   unavailable until populated. Soft revoke (delete the row) still works.
 * - `session_keys.allowedRecipients` enforcement is wired in monadSessionSigner
 *   (audit COM-004 fix Phase 1B): if the list is non-empty, recipients are
 *   checked off-chain before signing.
 */

import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  text,
  varchar,
  integer,
  smallint,
  bigint,
  boolean,
  timestamp,
  uuid,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Postgres native enums
// ---------------------------------------------------------------------------

/** Mirrors KycTier in state/user.rs (ordinal locked: T0Demo=0 … T3Pro=3) */
export const kycTierEnum = pgEnum("kyc_tier", [
  "t0_demo",
  "t1_lite",
  "t2_standard",
  "t3_pro",
]);

/** Communication channel for the agent conversation */
export const channelEnum = pgEnum("channel", ["whatsapp", "web"]);

/** Guardadito strategy provider */
export const savingsProviderEnum = pgEnum("savings_provider", ["mock", "neverland"]);

/** Guardadito position lifecycle */
export const savingsPositionStatusEnum = pgEnum("savings_position_status", [
  "active",
  "closed",
]);

/** Guardadito action kind */
export const savingsActionTypeEnum = pgEnum("savings_action_type", [
  "deposit",
  "withdraw",
]);

/** Guardadito action lifecycle */
export const savingsActionStatusEnum = pgEnum("savings_action_status", [
  "pending",
  "confirmed",
  "cancelled",
  "expired",
  "failed",
]);

/** On/off ramp direction */
export const rampDirectionEnum = pgEnum("ramp_direction", [
  "onramp",
  "offramp",
]);

/** Ramp lifecycle status */
export const rampStatusEnum = pgEnum("ramp_status", [
  "pending",
  "quoted",
  "confirmed",
  "completed",
  "failed",
]);

/** Sumsub KYC session status */
export const kycSessionStatusEnum = pgEnum("kyc_session_status", [
  "init",
  "pending",
  "approved",
  "rejected",
  "on_hold",
]);

/** Session key lifecycle (encrypted ZeroDev permission validator) */
export const sessionKeyStatusEnum = pgEnum("session_key_status", [
  "active",
  "expired",
  "revoked",
]);

/** Session key permission tier — daily (low cap) or elevated (OOB-gated). */
export const sessionKeyKindEnum = pgEnum("session_key_kind", [
  "daily",
  "elevated",
]);

/** Magic-link onboarding session status */
export const authSessionStatusEnum = pgEnum("auth_session_status", [
  "pending",
  "completed",
  "expired",
  "cancelled",
]);

/** OOB-confirmed elevated intent status */
export const elevatedIntentStatusEnum = pgEnum("elevated_intent_status", [
  "pending",
  "approved",
  "expired",
  "consumed",
]);

// ---------------------------------------------------------------------------
// Helper: shared timestamp helper
// ---------------------------------------------------------------------------
const ts = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });
const tsNow = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" }).defaultNow();

// ---------------------------------------------------------------------------
// 1. users — surrogate UUID identity (Monad + Privy)
// ---------------------------------------------------------------------------
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** SHA-256 hex of E.164 — human identity of the client (WhatsApp) */
    phoneHash: text("phone_hash").notNull(),
    /** Privy owner address (EVM, lowercase 0x). Null until onboarding completes. Auth lookup key. */
    ownerAddress: text("owner_address"),
    countryCode: varchar("country_code", { length: 2 }),
    kycTier: kycTierEnum("kyc_tier").notNull().default("t0_demo"),
    createdAt: ts("created_at").notNull(),
    updatedAt: tsNow("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("users_phone_hash_uidx").on(t.phoneHash),
    uniqueIndex("users_owner_address_uidx").on(t.ownerAddress),
    index("users_country_code_idx").on(t.countryCode),
  ]
);

// ---------------------------------------------------------------------------
// 2. conversations — agent conversation state (WhatsApp / web)
// ---------------------------------------------------------------------------
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null until the user completes phone verification */
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** SHA-256 hex of E.164 phone — identifies the conversation before user link */
    phoneHash: text("phone_hash").notNull(),
    channel: channelEnum("channel").notNull(),
    /**
     * Full Claude tool-use conversation history (array of message objects).
     * Stored as JSONB for partial updates and indexing in future.
     */
    messages: jsonb("messages").notNull().default([]),
    /**
     * Flow-specific scratch space: current onboarding step, pending tx hash,
     * selected strategy, etc. Schema evolves per agent flow version.
     */
    state: jsonb("state").notNull().default({}),
    createdAt: tsNow("created_at").notNull(),
    updatedAt: tsNow("updated_at").notNull(),
  },
  (t) => [
    index("conversations_phone_hash_idx").on(t.phoneHash),
    index("conversations_user_id_idx").on(t.userId),
  ]
);

// ---------------------------------------------------------------------------
// 3. idempotency_keys — per-key result cache (24h TTL, cleaned by cron)
// ---------------------------------------------------------------------------
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    /** The idempotency key provided by the client (UUID format) */
    key: text("key").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** API endpoint path, e.g. "/api/v1/transfers" */
    endpoint: text("endpoint").notNull(),
    statusCode: smallint("status_code").notNull(),
    responseBody: jsonb("response_body").notNull(),
    createdAt: tsNow("created_at").notNull(),
    /** createdAt + 24h; rows past this timestamp are eligible for deletion */
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [index("idempotency_keys_expires_at_idx").on(t.expiresAt)]
);

// ---------------------------------------------------------------------------
// 4. ramps — onramp / offramp records
// ---------------------------------------------------------------------------
export const ramps = pgTable(
  "ramps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    direction: rampDirectionEnum("direction").notNull(),
    /** Provider slug: "mock" | "transak" | "ramp" | … */
    provider: text("provider").notNull(),
    /** ISO 4217 currency code, e.g. "ARS", "MXN", "USD" */
    fiatCurrency: varchar("fiat_currency", { length: 3 }).notNull(),
    /** Fiat amount in minor units (cents / centavos) */
    fiatAmountCents: bigint("fiat_amount_cents", { mode: "bigint" }).notNull(),
    /** USDC amount in atomic units; null until the quote is locked */
    usdcAmount: bigint("usdc_amount", { mode: "bigint" }),
    status: rampStatusEnum("status").notNull().default("pending"),
    /** Provider-issued transaction reference / order ID */
    providerRef: text("provider_ref"),
    createdAt: tsNow("created_at").notNull(),
    updatedAt: tsNow("updated_at").notNull(),
  },
  (t) => [
    index("ramps_provider_ref_idx")
      .on(t.providerRef)
      .where(sql`provider_ref IS NOT NULL`),
  ]
);

// ---------------------------------------------------------------------------
// 5. kyc_sessions — Sumsub session tracking
// ---------------------------------------------------------------------------
export const kycSessions = pgTable(
  "kyc_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Sumsub applicantId; null until the SDK call succeeds */
    applicantId: text("applicant_id"),
    /** Sumsub verification level name, e.g. "basic-kyc-level" */
    levelName: text("level_name").notNull(),
    status: kycSessionStatusEnum("status").notNull().default("init"),
    /** Sumsub reviewAnswer: "GREEN" | "RED" | null */
    reviewAnswer: text("review_answer"),
    createdAt: tsNow("created_at").notNull(),
    updatedAt: tsNow("updated_at").notNull(),
  },
  (t) => [
    index("kyc_sessions_applicant_id_idx").on(t.applicantId),
    index("kyc_sessions_user_id_idx").on(t.userId),
  ]
);

// ---------------------------------------------------------------------------
// Phone-to-phone USDC transfers
//
// Off-chain ledger of P2P transfer intents. The on-chain operation is a
// standard ERC-20 Transfer — this table tracks the agent-led flow:
//   pending → confirmed   (immediate path: recipient registered)
//   awaiting_recipient → pending → confirmed   (deferred path: recipient
//                                              accepts via WhatsApp)
//
// Locking model is intentionally OFF-CHAIN (earmark only). The sender's USDC
// stays liquid until they sign the confirm step. Trade-off documented in the
// plan: a sender who spends elsewhere mid-flow will see status="failed" with
// failure_reason="insufficient balance at confirm time".
// ---------------------------------------------------------------------------

export const transferStatusEnum = pgEnum("transfer_status", [
  "pending",
  "awaiting_recipient",
  "awaiting_confirmation",
  "confirmed",
  "expired",
  "cancelled",
  "failed",
]);

export const transfers = pgTable(
  "transfers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    senderPhoneHash: text("sender_phone_hash").notNull(),
    recipientPhoneHash: text("recipient_phone_hash").notNull(),
    /** Null while status="awaiting_recipient" (recipient hasn't accepted yet). */
    recipientId: uuid("recipient_id").references(() => users.id, {
      onDelete: "set null",
    }),
    recipientWallet: text("recipient_wallet"),
    amountMicroUsdc: bigint("amount_micro_usdc", { mode: "bigint" }).notNull(),
    /** User-provided memo (e.g. "almuerzo"). Max 280 chars enforced at API layer. */
    note: text("note"),
    status: transferStatusEnum("status").notNull().default("pending"),
    /** Populated when status="confirmed". */
    txSignature: text("tx_signature"),
    failureReason: text("failure_reason"),
    createdAt: tsNow("created_at").notNull(),
    confirmedAt: ts("confirmed_at"),
    /**
     * 5 minutes for status="pending" (sender hasn't said "sí"); 7 days for
     * status="awaiting_recipient" (recipient onboarding window). Cron job
     * sweeps and marks expired rows.
     */
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [
    index("transfers_sender_idx").on(t.senderId),
    index("transfers_recipient_phone_idx").on(t.recipientPhoneHash),
    index("transfers_status_idx").on(t.status),
    index("transfers_expires_idx").on(t.expiresAt),
  ]
);

// ---------------------------------------------------------------------------
// Guardadito — USDC savings positions, actions, nudges, and encrypted contacts
//
// v1 is strategy-adapter based:
//   - provider="mock" is the default for demo/tests
//   - provider="neverland" is enabled only by env and external adapter config
//
// Phone numbers are not stored in clear text. `phone_ciphertext` carries an
// encrypted E.164 number so indexer/API can send opt-in proactive WhatsApp
// nudges without leaking PII in the database.
// ---------------------------------------------------------------------------

export const contactRoutes = pgTable(
  "contact_routes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    phoneHash: text("phone_hash").notNull(),
    phoneCiphertext: text("phone_ciphertext").notNull(),
    channel: channelEnum("channel").notNull().default("whatsapp"),
    createdAt: tsNow("created_at").notNull(),
    updatedAt: tsNow("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("contact_routes_user_channel_uidx").on(t.userId, t.channel),
    index("contact_routes_phone_hash_idx").on(t.phoneHash),
  ]
);

export const savingsPositions = pgTable(
  "savings_positions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: savingsProviderEnum("provider").notNull().default("mock"),
    strategyId: text("strategy_id").notNull(),
    depositedMicroUsdc: bigint("deposited_micro_usdc", { mode: "bigint" }).notNull().$default(() => BigInt(0)),
    /** Running total of principal (not yield) that has been withdrawn. Updated on each confirmed withdrawal. */
    principalWithdrawnMicroUsdc: bigint("principal_withdrawn_micro_usdc", { mode: "bigint" }).notNull().$default(() => BigInt(0)),
    shareAmount: text("share_amount").notNull().default("0"),
    lastKnownUnderlyingMicroUsdc: bigint("last_known_underlying_micro_usdc", {
      mode: "bigint",
    }).notNull().$default(() => BigInt(0)),
    status: savingsPositionStatusEnum("status").notNull().default("active"),
    createdAt: tsNow("created_at").notNull(),
    updatedAt: tsNow("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("savings_positions_user_strategy_uidx").on(t.userId, t.provider, t.strategyId),
    index("savings_positions_user_id_idx").on(t.userId),
  ]
);

export const savingsActions = pgTable(
  "savings_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: savingsProviderEnum("provider").notNull().default("mock"),
    strategyId: text("strategy_id").notNull(),
    type: savingsActionTypeEnum("type").notNull(),
    amountMicroUsdc: bigint("amount_micro_usdc", { mode: "bigint" }).notNull(),
    status: savingsActionStatusEnum("status").notNull().default("pending"),
    txSignature: text("tx_signature"),
    unsignedTxKey: text("unsigned_tx_key"),
    failureReason: text("failure_reason"),
    createdAt: tsNow("created_at").notNull(),
    confirmedAt: ts("confirmed_at"),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [
    index("savings_actions_user_id_idx").on(t.userId),
    index("savings_actions_status_idx").on(t.status),
    index("savings_actions_expires_idx").on(t.expiresAt),
  ]
);

export const savingsNudges = pgTable(
  "savings_nudges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    sourceRef: text("source_ref").notNull(),
    amountMicroUsdc: bigint("amount_micro_usdc", { mode: "bigint" }).notNull(),
    status: text("status").notNull().default("pending"),
    message: text("message"),
    createdAt: tsNow("created_at").notNull(),
    sentAt: ts("sent_at"),
  },
  (t) => [
    uniqueIndex("savings_nudges_source_ref_uidx").on(t.source, t.sourceRef),
    index("savings_nudges_user_id_idx").on(t.userId),
    index("savings_nudges_status_idx").on(t.status),
  ]
);

// ---------------------------------------------------------------------------
// Monad Account Abstraction tables (per docs/WALLET_SECURITY.md §8)
// ---------------------------------------------------------------------------

/**
 * One row per user — the Kernel v3.1 smart contract wallet on Monad.
 *
 * Owner = the Privy embedded EVM wallet (`owner_address`). The agent never
 * holds the owner private key; Privy custodies it on behalf of the user.
 */
export const smartWallets = pgTable(
  "smart_wallets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    privyUserId: text("privy_user_id").notNull(),
    ownerAddress: text("owner_address").notNull(),
    smartWalletAddress: text("smart_wallet_address").notNull(),
    chainId: integer("chain_id").notNull(),
    kernelVersion: text("kernel_version").notNull().default("v3.1"),
    /** True once we've observed the wallet's bytecode on-chain (post first UserOp). */
    deployedOnChain: boolean("deployed_on_chain").notNull().default(false),
    /** Turnkey-managed agent wallet address for this smart wallet (Phase 1A). */
    agentWalletAddress: text("agent_wallet_address"),
    createdAt: tsNow("created_at").notNull(),
    updatedAt: tsNow("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("smart_wallets_user_id_uidx").on(t.userId),
    uniqueIndex("smart_wallets_address_chain_uidx").on(
      t.smartWalletAddress,
      t.chainId
    ),
    index("smart_wallets_privy_user_idx").on(t.privyUserId),
  ]
);

/**
 * ZeroDev session keys — Turnkey-backed (Phase 1A migration).
 *
 * KMS envelope fields (ciphertext/dek_ciphertext/iv/encryption_version) have
 * been replaced with Turnkey sub-org/wallet references. The private key never
 * leaves Turnkey; we only store the org/wallet IDs needed to request a signature.
 *
 * `serialized_permission` = the ZeroDev serialized permission blob (the
 * permissioned-account blob that deserializePermissionAccount() expects), stored
 * so the signer can reconstruct the session key account without re-installing.
 *
 * `policies_json` carries the exact policy config used at install time — needed
 * to rebuild the same permission plugin for on-chain revocation, since
 * `permissionId` is deterministic from (signer + policies).
 */
export const sessionKeys = pgTable(
  "session_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    smartWalletId: uuid("smart_wallet_id")
      .notNull()
      .references(() => smartWallets.id, { onDelete: "cascade" }),
    kind: sessionKeyKindEnum("kind").notNull(),
    sessionAddress: text("session_address").notNull(),
    permissionId: text("permission_id").notNull(),
    /** Turnkey sub-organization ID (UUID) that owns the agent wallet. */
    turnkeySubOrgId: text("turnkey_sub_org_id").notNull(),
    /** Wallet ID within the Turnkey sub-org. */
    turnkeyWalletId: text("turnkey_wallet_id").notNull(),
    /** ZeroDev serialized permission blob for this session key. */
    serializedPermission: text("serialized_permission").notNull(),
    policiesJson: jsonb("policies_json").notNull(),
    /** Per-call cap in micro-USDC (fast pre-check before KMS decrypt). */
    perCallCapMicroUsdc: bigint("per_call_cap_micro_usdc", {
      mode: "bigint",
    }).notNull(),
    allowedContracts: jsonb("allowed_contracts").notNull(),
    allowedRecipients: jsonb("allowed_recipients").notNull().default([]),
    validUntil: ts("valid_until").notNull(),
    status: sessionKeyStatusEnum("status").notNull().default("active"),
    lastUsedAt: ts("last_used_at"),
    createdAt: tsNow("created_at").notNull(),
  },
  (t) => [
    index("session_keys_smart_wallet_idx").on(t.smartWalletId),
    index("session_keys_valid_until_idx").on(t.validUntil),
    index("session_keys_status_idx").on(t.status),
    uniqueIndex("session_keys_address_uidx").on(t.sessionAddress),
  ]
);

/**
 * Short-lived magic-link onboarding sessions.
 *
 * Flow: WhatsApp asks Comadre to register → backend issues a token here →
 * Twilio SMS link → user opens browser page → Privy auth → callback fills
 * `privy_user_id` + `owner_address` → backend marks `completed` and writes
 * the matching `smart_wallets` + `session_keys` rows.
 */
export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    phoneHash: text("phone_hash").notNull(),
    magicToken: text("magic_token").notNull(),
    status: authSessionStatusEnum("status").notNull().default("pending"),
    privyUserId: text("privy_user_id"),
    ownerAddress: text("owner_address"),
    expiresAt: ts("expires_at").notNull(),
    completedAt: ts("completed_at"),
    createdAt: tsNow("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("auth_sessions_token_uidx").on(t.magicToken),
    index("auth_sessions_phone_idx").on(t.phoneHash),
    index("auth_sessions_expires_idx").on(t.expiresAt),
  ]
);

/**
 * OOB-confirmed elevated intents.
 *
 * Created when the user requests an operation over the daily session cap.
 * The row holds a Twilio Verify SID and the action descriptor; once the user
 * supplies a valid OTP, status flips to `approved` and the backend may
 * decrypt the elevated session key once (then mark `consumed`).
 */
export const elevatedIntents = pgTable(
  "elevated_intents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    smartWalletId: uuid("smart_wallet_id")
      .notNull()
      .references(() => smartWallets.id, { onDelete: "cascade" }),
    actionPayload: jsonb("action_payload").notNull(),
    twilioVerifySid: text("twilio_verify_sid").notNull(),
    status: elevatedIntentStatusEnum("status").notNull().default("pending"),
    expiresAt: ts("expires_at").notNull(),
    createdAt: tsNow("created_at").notNull(),
    consumedAt: ts("consumed_at"),
  },
  (t) => [
    index("elevated_intents_smart_wallet_idx").on(t.smartWalletId),
    index("elevated_intents_expires_idx").on(t.expiresAt),
    index("elevated_intents_status_idx").on(t.status),
  ]
);
