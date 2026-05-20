/**
 * @comadre/db — Drizzle ORM schema (Monad-only post Phase 1)
 *
 * Tables: users, smart_wallets, session_keys, auth_sessions, elevated_intents,
 * tandas (Solidity mirror), members, disputes, dispute_votes, conversations,
 * idempotency_keys, ramps, kyc_sessions, transfers, contact_routes,
 * savings_positions, savings_actions, savings_nudges.
 *
 * Design decisions:
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

/** Mirrors TandaState in state/tanda.rs */
export const tandaStateEnum = pgEnum("tanda_state", [
  "forming",
  "active",
  "paused",
  "completed",
  "cancelled",
]);

/** Mirrors PayoutOrder in state/tanda.rs */
export const payoutOrderEnum = pgEnum("payout_order", [
  "join_order",
  "creator_set",
  "random",
]);

/**
 * Mirrors DisputeState in state/dispute.rs.
 * The on-chain enum has Open/Resolved/Expired; we split Resolved into two
 * values here to distinguish the vote outcome at the DB layer.
 *
 * ⚠️  INDEXER CONTRACT: when the on-chain `Resolved` event arrives, the indexer
 * MUST inspect `votes_continue > votes_cancel` BEFORE inserting and write either
 * `resolved_continue` or `resolved_cancel`. Never write the raw on-chain variant.
 */
export const disputeStateEnum = pgEnum("dispute_state", [
  "open",
  "resolved_continue",
  "resolved_cancel",
  "expired",
]);

/** Mirrors BadgeType in state/badge.rs */
export const badgeTypeEnum = pgEnum("badge_type", [
  "tanda_completed",
  "tanda_created_and_completed",
  "loan_repaid_on_time",
  "dispute_resolved_fairly",
]);

/** Communication channel for the agent conversation */
export const channelEnum = pgEnum("channel", ["whatsapp", "web"]);

/** Guardadito strategy provider */
export const savingsProviderEnum = pgEnum("savings_provider", ["mock", "kamino"]);

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

/**
 * Mirrors LoanState in state/loan.rs exactly.
 * On-chain variants: Pending | Active | Repaid | Defaulted (ordinal 0–3).
 */
export const loanStateEnum = pgEnum("loan_state", [
  "pending",
  "active",
  "repaid",
  "defaulted",
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
// 1. users — mirrors UserProfile on-chain account
// ---------------------------------------------------------------------------
export const users = pgTable(
  "users",
  {
    /** Base58 Solana pubkey — also the on-chain account address */
    wallet: text("wallet").primaryKey(),
    /** SHA-256 hex digest of E.164 phone number (e.g. "+5491112345678") */
    phoneHash: text("phone_hash").notNull(),
    /** ISO 3166-1 alpha-2 country code, e.g. "AR" */
    countryCode: varchar("country_code", { length: 2 }),
    kycTier: kycTierEnum("kyc_tier").notNull().default("t0_demo"),
    reputationScore: integer("reputation_score").notNull().default(0),
    tandasCompleted: integer("tandas_completed").notNull().default(0),
    tandasDefaulted: integer("tandas_defaulted").notNull().default(0),
    /**
     * On-chain u64 — bigint to prevent silent narrowing.
     * tandasCompleted / tandasDefaulted / loansRepaid / loansDefaulted are u16
     * on-chain and fit safely in Postgres integer (max 65 535 << 2 147 483 647).
     */
    tandasCreated: bigint("tandas_created", { mode: "bigint" }).notNull().$default(() => BigInt(0)),
    loansRepaid: integer("loans_repaid").notNull().default(0),
    loansDefaulted: integer("loans_defaulted").notNull().default(0),
    createdAt: ts("created_at").notNull(),
    /** Updated by the indexer on every sync or by the API on profile writes */
    updatedAt: tsNow("updated_at").notNull(),
  },
  (t) => [
    index("users_phone_hash_idx").on(t.phoneHash),
    index("users_country_code_idx").on(t.countryCode),
  ]
);

// ---------------------------------------------------------------------------
// 2. tandas — mirrors Tanda on-chain account
// ---------------------------------------------------------------------------
export const tandas = pgTable(
  "tandas",
  {
    /** Tanda PDA pubkey (base58) — primary identifier */
    id: text("id").primaryKey(),
    creatorWallet: text("creator_wallet")
      .notNull()
      .references(() => users.wallet),
    /** On-chain u64 tanda_id (creator-scoped sequential ID) */
    tandaId: bigint("tanda_id", { mode: "bigint" }).notNull(),
    /** SHA-256 hex of the name string */
    nameHash: text("name_hash").notNull(),
    /** Off-chain denormalized display name; null until the indexer resolves it */
    name: text("name"),
    usdcMint: text("usdc_mint").notNull(),
    vault: text("vault").notNull(),
    memberTarget: smallint("member_target").notNull(),
    memberCurrent: smallint("member_current").notNull().default(0),
    /** Per-round contribution in atomic USDC units (micro-USDC, 6 decimals) */
    contributionAmount: bigint("contribution_amount", {
      mode: "bigint",
    }).notNull(),
    /** Collateral per member in atomic USDC units */
    stakeAmount: bigint("stake_amount", { mode: "bigint" }).notNull(),
    /**
     * Round cadence in seconds (on-chain: u32, but stored as bigint to match
     * the broader u64 pattern; values fit comfortably in a 32-bit range).
     */
    frequencySeconds: bigint("frequency_seconds", { mode: "bigint" }).notNull(),
    totalTurns: smallint("total_turns").notNull(),
    currentTurn: smallint("current_turn").notNull().default(0),
    state: tandaStateEnum("state").notNull().default("forming"),
    payoutOrderMode: payoutOrderEnum("payout_order_mode")
      .notNull()
      .default("join_order"),
    nextPayoutTs: ts("next_payout_ts"),
    startedAt: ts("started_at"),
    createdAt: ts("created_at").notNull(),
    /** Timestamp of the last indexer write — used for lag monitoring */
    lastSyncedAt: tsNow("last_synced_at").notNull(),
  },
  (t) => [
    index("tandas_state_idx").on(t.state),
    index("tandas_creator_wallet_idx").on(t.creatorWallet),
  ]
);

// ---------------------------------------------------------------------------
// 3. members — mirrors Member on-chain account
// ---------------------------------------------------------------------------
export const members = pgTable(
  "members",
  {
    /** Member PDA pubkey (base58) */
    id: text("id").primaryKey(),
    tandaId: text("tanda_id")
      .notNull()
      .references(() => tandas.id, { onDelete: "cascade" }),
    userWallet: text("user_wallet")
      .notNull()
      .references(() => users.wallet),
    turnNumber: smallint("turn_number").notNull(),
    contributionsMade: smallint("contributions_made").notNull().default(0),
    lastContributionTs: ts("last_contribution_ts"),
    stakeLocked: bigint("stake_locked", { mode: "bigint" }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    hasReceivedPayout: boolean("has_received_payout").notNull().default(false),
    joinedAt: ts("joined_at").notNull(),
  },
  (t) => [
    uniqueIndex("members_tanda_user_uidx").on(t.tandaId, t.userWallet),
    uniqueIndex("members_tanda_turn_uidx").on(t.tandaId, t.turnNumber),
  ]
);

// ---------------------------------------------------------------------------
// 4. disputes — mirrors Dispute on-chain account
// ---------------------------------------------------------------------------
export const disputes = pgTable(
  "disputes",
  {
    /** Dispute PDA pubkey (base58) */
    id: text("id").primaryKey(),
    tandaId: text("tanda_id")
      .notNull()
      .references(() => tandas.id, { onDelete: "cascade" }),
    /** On-chain u8 dispute_id (scoped to the tanda) */
    disputeId: bigint("dispute_id", { mode: "bigint" }).notNull(),
    openerWallet: text("opener_wallet").notNull(),
    reasonHash: text("reason_hash").notNull(),
    /** Off-chain plain-text reason; populated by the opener via API */
    reasonText: text("reason_text"),
    openedAt: ts("opened_at").notNull(),
    deadlineTs: ts("deadline_ts").notNull(),
    votesContinue: smallint("votes_continue").notNull().default(0),
    votesCancel: smallint("votes_cancel").notNull().default(0),
    state: disputeStateEnum("state").notNull().default("open"),
  },
  (t) => [
    index("disputes_state_idx").on(t.state),
    index("disputes_deadline_ts_idx").on(t.deadlineTs),
  ]
);

// ---------------------------------------------------------------------------
// 5. dispute_votes — mirrors DisputeVote on-chain account
// ---------------------------------------------------------------------------
export const disputeVotes = pgTable(
  "dispute_votes",
  {
    /** DisputeVote PDA pubkey (base58) */
    id: text("id").primaryKey(),
    disputeId: text("dispute_id")
      .notNull()
      .references(() => disputes.id, { onDelete: "cascade" }),
    voterWallet: text("voter_wallet").notNull(),
    continueTanda: boolean("continue_tanda").notNull(),
    votedAt: ts("voted_at").notNull(),
  },
  (t) => [
    uniqueIndex("dispute_votes_dispute_voter_uidx").on(
      t.disputeId,
      t.voterWallet
    ),
  ]
);

// ---------------------------------------------------------------------------
// 6. loans — minimal; full model deferred post-hackathon
// ---------------------------------------------------------------------------
export const loans = pgTable(
  "loans",
  {
    /** Loan PDA pubkey (base58) */
    id: text("id").primaryKey(),
    /** On-chain u64 loan_id — required to reconstruct the Loan PDA */
    loanId: bigint("loan_id", { mode: "bigint" }).notNull(),
    borrowerWallet: text("borrower_wallet").notNull(),
    /** The tanda that backs this loan as collateral, if any */
    tandaBacking: text("tanda_backing").references(() => tandas.id, {
      onDelete: "set null",
    }),
    /** Principal in atomic USDC units */
    principal: bigint("principal", { mode: "bigint" }).notNull(),
    /** Annual percentage rate in basis points (e.g. 1500 = 15%) */
    aprBps: integer("apr_bps").notNull(),
    totalRepaid: bigint("total_repaid", { mode: "bigint" })
      .notNull()
      .$default(() => BigInt(0)),
    /** On-chain u8 — number of cosigners required */
    cosignerCount: smallint("cosigner_count").notNull().default(0),
    /** On-chain u8 — number of cosigners who have signed so far */
    cosignersSigned: smallint("cosigners_signed").notNull().default(0),
    disbursedAt: ts("disbursed_at"),
    dueTs: ts("due_ts"),
    state: loanStateEnum("state").notNull().default("pending"),
  },
  (t) => [
    index("loans_borrower_wallet_idx").on(t.borrowerWallet),
    index("loans_state_idx").on(t.state),
  ]
);

// ---------------------------------------------------------------------------
// 7. loan_cosigners — minimal; mirrors LoanCosigner on-chain account
// ---------------------------------------------------------------------------
export const loanCosigners = pgTable("loan_cosigners", {
  /** LoanCosigner PDA pubkey (base58) */
  id: text("id").primaryKey(),
  loanId: text("loan_id")
    .notNull()
    .references(() => loans.id, { onDelete: "cascade" }),
  cosignerWallet: text("cosigner_wallet").notNull(),
  stakeLocked: bigint("stake_locked", { mode: "bigint" }).notNull(),
  hasSigned: boolean("has_signed").notNull().default(false),
  signedAt: ts("signed_at"),
});

// ---------------------------------------------------------------------------
// 8. badges — mirrors ReputationBadge on-chain account
// ---------------------------------------------------------------------------
export const badges = pgTable(
  "badges",
  {
    /** ReputationBadge PDA pubkey (base58) */
    id: text("id").primaryKey(),
    /** On-chain u64 badge_id — required to reconstruct the Badge PDA */
    badgeId: bigint("badge_id", { mode: "bigint" }).notNull(),
    userWallet: text("user_wallet")
      .notNull()
      .references(() => users.wallet, { onDelete: "cascade" }),
    badgeType: badgeTypeEnum("badge_type").notNull(),
    /** The on-chain account that triggered this badge (tanda, loan, dispute PDA) */
    sourceAccount: text("source_account").notNull(),
    /** On-chain u64 value field (purpose varies per badge type) */
    value: bigint("value", { mode: "bigint" }).notNull(),
    earnedAt: ts("earned_at").notNull(),
  },
  (t) => [index("badges_user_wallet_idx").on(t.userWallet)]
);

// ---------------------------------------------------------------------------
// 9. conversations — agent conversation state (WhatsApp / web)
// ---------------------------------------------------------------------------
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null until the user completes phone verification */
    userWallet: text("user_wallet").references(() => users.wallet, {
      onDelete: "set null",
    }),
    /** SHA-256 hex of E.164 phone — identifies the conversation before wallet link */
    phoneHash: text("phone_hash").notNull(),
    channel: channelEnum("channel").notNull(),
    /**
     * Full Claude tool-use conversation history (array of message objects).
     * Stored as JSONB for partial updates and indexing in future.
     */
    messages: jsonb("messages").notNull().default([]),
    /**
     * Flow-specific scratch space: current onboarding step, pending tx hash,
     * selected tanda, etc. Schema evolves per agent flow version.
     */
    state: jsonb("state").notNull().default({}),
    createdAt: tsNow("created_at").notNull(),
    updatedAt: tsNow("updated_at").notNull(),
  },
  (t) => [
    index("conversations_phone_hash_idx").on(t.phoneHash),
    index("conversations_user_wallet_idx").on(t.userWallet),
  ]
);

// ---------------------------------------------------------------------------
// 10. idempotency_keys — per-key result cache (24h TTL, cleaned by cron)
// ---------------------------------------------------------------------------
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    /** The idempotency key provided by the client (UUID format) */
    key: text("key").primaryKey(),
    userWallet: text("user_wallet").notNull(),
    /** API endpoint path, e.g. "/api/v1/tandas" */
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
// 11. ramps — onramp / offramp records
// ---------------------------------------------------------------------------
export const ramps = pgTable(
  "ramps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userWallet: text("user_wallet").notNull(),
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
// 12. kyc_sessions — Sumsub session tracking
// ---------------------------------------------------------------------------
export const kycSessions = pgTable(
  "kyc_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userWallet: text("user_wallet")
      .notNull()
      .references(() => users.wallet, { onDelete: "cascade" }),
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
    index("kyc_sessions_user_wallet_idx").on(t.userWallet),
  ]
);

// ---------------------------------------------------------------------------
// Phone-to-phone USDC transfers
//
// Off-chain ledger of P2P transfer intents. The on-chain operation is a
// standard SPL Token Transfer — this table tracks the agent-led flow:
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
  "confirmed",
  "expired",
  "cancelled",
  "failed",
]);

export const transfers = pgTable(
  "transfers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    senderWallet: text("sender_wallet")
      .notNull()
      .references(() => users.wallet, { onDelete: "cascade" }),
    senderPhoneHash: text("sender_phone_hash").notNull(),
    recipientPhoneHash: text("recipient_phone_hash").notNull(),
    /** Null while status="awaiting_recipient" (recipient hasn't accepted yet). */
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
    index("transfers_sender_idx").on(t.senderWallet),
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
//   - provider="kamino" is enabled only by env and external adapter config
//
// Phone numbers are not stored in clear text. `phone_ciphertext` carries an
// encrypted E.164 number so indexer/API can send opt-in proactive WhatsApp
// nudges without leaking PII in the database.
// ---------------------------------------------------------------------------

export const contactRoutes = pgTable(
  "contact_routes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userWallet: text("user_wallet")
      .notNull()
      .references(() => users.wallet, { onDelete: "cascade" }),
    phoneHash: text("phone_hash").notNull(),
    phoneCiphertext: text("phone_ciphertext").notNull(),
    channel: channelEnum("channel").notNull().default("whatsapp"),
    createdAt: tsNow("created_at").notNull(),
    updatedAt: tsNow("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("contact_routes_wallet_channel_uidx").on(t.userWallet, t.channel),
    index("contact_routes_phone_hash_idx").on(t.phoneHash),
  ]
);

export const savingsPositions = pgTable(
  "savings_positions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userWallet: text("user_wallet")
      .notNull()
      .references(() => users.wallet, { onDelete: "cascade" }),
    provider: savingsProviderEnum("provider").notNull().default("mock"),
    strategyId: text("strategy_id").notNull(),
    depositedMicroUsdc: bigint("deposited_micro_usdc", { mode: "bigint" }).notNull().$default(() => BigInt(0)),
    shareAmount: text("share_amount").notNull().default("0"),
    lastKnownUnderlyingMicroUsdc: bigint("last_known_underlying_micro_usdc", {
      mode: "bigint",
    }).notNull().$default(() => BigInt(0)),
    status: savingsPositionStatusEnum("status").notNull().default("active"),
    createdAt: tsNow("created_at").notNull(),
    updatedAt: tsNow("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("savings_positions_wallet_strategy_uidx").on(t.userWallet, t.provider, t.strategyId),
    index("savings_positions_wallet_idx").on(t.userWallet),
  ]
);

export const savingsActions = pgTable(
  "savings_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userWallet: text("user_wallet")
      .notNull()
      .references(() => users.wallet, { onDelete: "cascade" }),
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
    index("savings_actions_wallet_idx").on(t.userWallet),
    index("savings_actions_status_idx").on(t.status),
    index("savings_actions_expires_idx").on(t.expiresAt),
  ]
);

export const savingsNudges = pgTable(
  "savings_nudges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userWallet: text("user_wallet")
      .notNull()
      .references(() => users.wallet, { onDelete: "cascade" }),
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
    index("savings_nudges_wallet_idx").on(t.userWallet),
    index("savings_nudges_status_idx").on(t.status),
  ]
);

// ---------------------------------------------------------------------------
// Monad Account Abstraction tables (per docs/WALLET_SECURITY.md §8)
//
// These coexist with the existing Solana custodial path during the migration
// window. `user_keypairs` (plaintext) is deprecated and will be dropped only
// after every signing path on the API has moved to session keys.
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
    userWallet: text("user_wallet")
      .notNull()
      .references(() => users.wallet, { onDelete: "cascade" }),
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
    uniqueIndex("smart_wallets_user_wallet_uidx").on(t.userWallet),
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
