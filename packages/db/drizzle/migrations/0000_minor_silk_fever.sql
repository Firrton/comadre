CREATE TYPE "public"."auth_session_status" AS ENUM('pending', 'completed', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."channel" AS ENUM('whatsapp', 'web');--> statement-breakpoint
CREATE TYPE "public"."elevated_intent_status" AS ENUM('pending', 'approved', 'expired', 'consumed');--> statement-breakpoint
CREATE TYPE "public"."kyc_session_status" AS ENUM('init', 'pending', 'approved', 'rejected', 'on_hold');--> statement-breakpoint
CREATE TYPE "public"."kyc_tier" AS ENUM('t0_demo', 't1_lite', 't2_standard', 't3_pro');--> statement-breakpoint
CREATE TYPE "public"."ramp_direction" AS ENUM('onramp', 'offramp');--> statement-breakpoint
CREATE TYPE "public"."ramp_status" AS ENUM('pending', 'quoted', 'confirmed', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."savings_action_status" AS ENUM('pending', 'confirmed', 'cancelled', 'expired', 'failed');--> statement-breakpoint
CREATE TYPE "public"."savings_action_type" AS ENUM('deposit', 'withdraw');--> statement-breakpoint
CREATE TYPE "public"."savings_position_status" AS ENUM('active', 'closed');--> statement-breakpoint
CREATE TYPE "public"."savings_provider" AS ENUM('mock', 'neverland');--> statement-breakpoint
CREATE TYPE "public"."session_key_kind" AS ENUM('daily', 'elevated');--> statement-breakpoint
CREATE TYPE "public"."session_key_status" AS ENUM('active', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."transfer_status" AS ENUM('pending', 'awaiting_recipient', 'confirmed', 'expired', 'cancelled', 'failed');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_hash" text NOT NULL,
	"magic_token" text NOT NULL,
	"status" "auth_session_status" DEFAULT 'pending' NOT NULL,
	"privy_user_id" text,
	"owner_address" text,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contact_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"phone_hash" text NOT NULL,
	"phone_ciphertext" text NOT NULL,
	"channel" "channel" DEFAULT 'whatsapp' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"phone_hash" text NOT NULL,
	"channel" "channel" NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "elevated_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"smart_wallet_id" uuid NOT NULL,
	"action_payload" jsonb NOT NULL,
	"twilio_verify_sid" text NOT NULL,
	"status" "elevated_intent_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "idempotency_keys" (
	"key" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"status_code" smallint NOT NULL,
	"response_body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kyc_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"applicant_id" text,
	"level_name" text NOT NULL,
	"status" "kyc_session_status" DEFAULT 'init' NOT NULL,
	"review_answer" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ramps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"direction" "ramp_direction" NOT NULL,
	"provider" text NOT NULL,
	"fiat_currency" varchar(3) NOT NULL,
	"fiat_amount_cents" bigint NOT NULL,
	"usdc_amount" bigint,
	"status" "ramp_status" DEFAULT 'pending' NOT NULL,
	"provider_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "savings_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "savings_provider" DEFAULT 'mock' NOT NULL,
	"strategy_id" text NOT NULL,
	"type" "savings_action_type" NOT NULL,
	"amount_micro_usdc" bigint NOT NULL,
	"status" "savings_action_status" DEFAULT 'pending' NOT NULL,
	"tx_signature" text,
	"unsigned_tx_key" text,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "savings_nudges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_ref" text NOT NULL,
	"amount_micro_usdc" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "savings_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "savings_provider" DEFAULT 'mock' NOT NULL,
	"strategy_id" text NOT NULL,
	"deposited_micro_usdc" bigint NOT NULL,
	"principal_withdrawn_micro_usdc" bigint NOT NULL,
	"share_amount" text DEFAULT '0' NOT NULL,
	"last_known_underlying_micro_usdc" bigint NOT NULL,
	"status" "savings_position_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "session_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"smart_wallet_id" uuid NOT NULL,
	"kind" "session_key_kind" NOT NULL,
	"session_address" text NOT NULL,
	"permission_id" text NOT NULL,
	"turnkey_sub_org_id" text NOT NULL,
	"turnkey_wallet_id" text NOT NULL,
	"serialized_permission" text NOT NULL,
	"policies_json" jsonb NOT NULL,
	"per_call_cap_micro_usdc" bigint NOT NULL,
	"allowed_contracts" jsonb NOT NULL,
	"allowed_recipients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"status" "session_key_status" DEFAULT 'active' NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "smart_wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"privy_user_id" text NOT NULL,
	"owner_address" text NOT NULL,
	"smart_wallet_address" text NOT NULL,
	"chain_id" integer NOT NULL,
	"kernel_version" text DEFAULT 'v3.1' NOT NULL,
	"deployed_on_chain" boolean DEFAULT false NOT NULL,
	"agent_wallet_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_id" uuid NOT NULL,
	"sender_phone_hash" text NOT NULL,
	"recipient_phone_hash" text NOT NULL,
	"recipient_id" uuid,
	"recipient_wallet" text,
	"amount_micro_usdc" bigint NOT NULL,
	"note" text,
	"status" "transfer_status" DEFAULT 'pending' NOT NULL,
	"tx_signature" text,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_hash" text NOT NULL,
	"owner_address" text,
	"country_code" varchar(2),
	"kyc_tier" "kyc_tier" DEFAULT 't0_demo' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_routes" ADD CONSTRAINT "contact_routes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "elevated_intents" ADD CONSTRAINT "elevated_intents_smart_wallet_id_smart_wallets_id_fk" FOREIGN KEY ("smart_wallet_id") REFERENCES "public"."smart_wallets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kyc_sessions" ADD CONSTRAINT "kyc_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ramps" ADD CONSTRAINT "ramps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "savings_actions" ADD CONSTRAINT "savings_actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "savings_nudges" ADD CONSTRAINT "savings_nudges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "savings_positions" ADD CONSTRAINT "savings_positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "session_keys" ADD CONSTRAINT "session_keys_smart_wallet_id_smart_wallets_id_fk" FOREIGN KEY ("smart_wallet_id") REFERENCES "public"."smart_wallets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "smart_wallets" ADD CONSTRAINT "smart_wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transfers" ADD CONSTRAINT "transfers_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transfers" ADD CONSTRAINT "transfers_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auth_sessions_token_uidx" ON "auth_sessions" USING btree ("magic_token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_sessions_phone_idx" ON "auth_sessions" USING btree ("phone_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_sessions_expires_idx" ON "auth_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contact_routes_user_channel_uidx" ON "contact_routes" USING btree ("user_id","channel");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_routes_phone_hash_idx" ON "contact_routes" USING btree ("phone_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_phone_hash_idx" ON "conversations" USING btree ("phone_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_user_id_idx" ON "conversations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "elevated_intents_smart_wallet_idx" ON "elevated_intents" USING btree ("smart_wallet_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "elevated_intents_expires_idx" ON "elevated_intents" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "elevated_intents_status_idx" ON "elevated_intents" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idempotency_keys_expires_at_idx" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kyc_sessions_applicant_id_idx" ON "kyc_sessions" USING btree ("applicant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kyc_sessions_user_id_idx" ON "kyc_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ramps_provider_ref_idx" ON "ramps" USING btree ("provider_ref") WHERE provider_ref IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "savings_actions_user_id_idx" ON "savings_actions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "savings_actions_status_idx" ON "savings_actions" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "savings_actions_expires_idx" ON "savings_actions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "savings_nudges_source_ref_uidx" ON "savings_nudges" USING btree ("source","source_ref");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "savings_nudges_user_id_idx" ON "savings_nudges" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "savings_nudges_status_idx" ON "savings_nudges" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "savings_positions_user_strategy_uidx" ON "savings_positions" USING btree ("user_id","provider","strategy_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "savings_positions_user_id_idx" ON "savings_positions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_keys_smart_wallet_idx" ON "session_keys" USING btree ("smart_wallet_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_keys_valid_until_idx" ON "session_keys" USING btree ("valid_until");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_keys_status_idx" ON "session_keys" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "session_keys_address_uidx" ON "session_keys" USING btree ("session_address");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "smart_wallets_user_id_uidx" ON "smart_wallets" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "smart_wallets_address_chain_uidx" ON "smart_wallets" USING btree ("smart_wallet_address","chain_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "smart_wallets_privy_user_idx" ON "smart_wallets" USING btree ("privy_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transfers_sender_idx" ON "transfers" USING btree ("sender_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transfers_recipient_phone_idx" ON "transfers" USING btree ("recipient_phone_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transfers_status_idx" ON "transfers" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transfers_expires_idx" ON "transfers" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_phone_hash_uidx" ON "users" USING btree ("phone_hash");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_owner_address_uidx" ON "users" USING btree ("owner_address");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_country_code_idx" ON "users" USING btree ("country_code");