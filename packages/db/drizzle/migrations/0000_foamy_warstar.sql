CREATE TYPE "public"."badge_type" AS ENUM('tanda_completed', 'tanda_created_and_completed', 'loan_repaid_on_time', 'dispute_resolved_fairly');--> statement-breakpoint
CREATE TYPE "public"."channel" AS ENUM('whatsapp', 'web');--> statement-breakpoint
CREATE TYPE "public"."dispute_state" AS ENUM('open', 'resolved_continue', 'resolved_cancel', 'expired');--> statement-breakpoint
CREATE TYPE "public"."kyc_session_status" AS ENUM('init', 'pending', 'approved', 'rejected', 'on_hold');--> statement-breakpoint
CREATE TYPE "public"."kyc_tier" AS ENUM('t0_demo', 't1_lite', 't2_standard', 't3_pro');--> statement-breakpoint
CREATE TYPE "public"."loan_state" AS ENUM('pending', 'active', 'repaid', 'defaulted');--> statement-breakpoint
CREATE TYPE "public"."payout_order" AS ENUM('join_order', 'creator_set', 'random');--> statement-breakpoint
CREATE TYPE "public"."ramp_direction" AS ENUM('onramp', 'offramp');--> statement-breakpoint
CREATE TYPE "public"."ramp_status" AS ENUM('pending', 'quoted', 'confirmed', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."tanda_state" AS ENUM('forming', 'active', 'paused', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "badges" (
	"id" text PRIMARY KEY NOT NULL,
	"badge_id" bigint NOT NULL,
	"user_wallet" text NOT NULL,
	"badge_type" "badge_type" NOT NULL,
	"source_account" text NOT NULL,
	"value" bigint NOT NULL,
	"earned_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_wallet" text,
	"phone_hash" text NOT NULL,
	"channel" "channel" NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dispute_votes" (
	"id" text PRIMARY KEY NOT NULL,
	"dispute_id" text NOT NULL,
	"voter_wallet" text NOT NULL,
	"continue_tanda" boolean NOT NULL,
	"voted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "disputes" (
	"id" text PRIMARY KEY NOT NULL,
	"tanda_id" text NOT NULL,
	"dispute_id" bigint NOT NULL,
	"opener_wallet" text NOT NULL,
	"reason_hash" text NOT NULL,
	"reason_text" text,
	"opened_at" timestamp with time zone NOT NULL,
	"deadline_ts" timestamp with time zone NOT NULL,
	"votes_continue" smallint DEFAULT 0 NOT NULL,
	"votes_cancel" smallint DEFAULT 0 NOT NULL,
	"state" "dispute_state" DEFAULT 'open' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "idempotency_keys" (
	"key" text PRIMARY KEY NOT NULL,
	"user_wallet" text NOT NULL,
	"endpoint" text NOT NULL,
	"status_code" smallint NOT NULL,
	"response_body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kyc_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_wallet" text NOT NULL,
	"applicant_id" text,
	"level_name" text NOT NULL,
	"status" "kyc_session_status" DEFAULT 'init' NOT NULL,
	"review_answer" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "loan_cosigners" (
	"id" text PRIMARY KEY NOT NULL,
	"loan_id" text NOT NULL,
	"cosigner_wallet" text NOT NULL,
	"stake_locked" bigint NOT NULL,
	"has_signed" boolean DEFAULT false NOT NULL,
	"signed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "loans" (
	"id" text PRIMARY KEY NOT NULL,
	"loan_id" bigint NOT NULL,
	"borrower_wallet" text NOT NULL,
	"tanda_backing" text,
	"principal" bigint NOT NULL,
	"apr_bps" integer NOT NULL,
	"total_repaid" bigint NOT NULL,
	"cosigner_count" smallint DEFAULT 0 NOT NULL,
	"cosigners_signed" smallint DEFAULT 0 NOT NULL,
	"disbursed_at" timestamp with time zone,
	"due_ts" timestamp with time zone,
	"state" "loan_state" DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "members" (
	"id" text PRIMARY KEY NOT NULL,
	"tanda_id" text NOT NULL,
	"user_wallet" text NOT NULL,
	"turn_number" smallint NOT NULL,
	"contributions_made" smallint DEFAULT 0 NOT NULL,
	"last_contribution_ts" timestamp with time zone,
	"stake_locked" bigint NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"has_received_payout" boolean DEFAULT false NOT NULL,
	"joined_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ramps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_wallet" text NOT NULL,
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
CREATE TABLE IF NOT EXISTS "tandas" (
	"id" text PRIMARY KEY NOT NULL,
	"creator_wallet" text NOT NULL,
	"tanda_id" bigint NOT NULL,
	"name_hash" text NOT NULL,
	"name" text,
	"usdc_mint" text NOT NULL,
	"vault" text NOT NULL,
	"member_target" smallint NOT NULL,
	"member_current" smallint DEFAULT 0 NOT NULL,
	"contribution_amount" bigint NOT NULL,
	"stake_amount" bigint NOT NULL,
	"frequency_seconds" bigint NOT NULL,
	"total_turns" smallint NOT NULL,
	"current_turn" smallint DEFAULT 0 NOT NULL,
	"state" "tanda_state" DEFAULT 'forming' NOT NULL,
	"payout_order_mode" "payout_order" DEFAULT 'join_order' NOT NULL,
	"next_payout_ts" timestamp with time zone,
	"started_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"wallet" text PRIMARY KEY NOT NULL,
	"phone_hash" text NOT NULL,
	"country_code" varchar(2),
	"kyc_tier" "kyc_tier" DEFAULT 't0_demo' NOT NULL,
	"reputation_score" integer DEFAULT 0 NOT NULL,
	"tandas_completed" integer DEFAULT 0 NOT NULL,
	"tandas_defaulted" integer DEFAULT 0 NOT NULL,
	"tandas_created" bigint NOT NULL,
	"loans_repaid" integer DEFAULT 0 NOT NULL,
	"loans_defaulted" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "badges" ADD CONSTRAINT "badges_user_wallet_users_wallet_fk" FOREIGN KEY ("user_wallet") REFERENCES "public"."users"("wallet") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_wallet_users_wallet_fk" FOREIGN KEY ("user_wallet") REFERENCES "public"."users"("wallet") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dispute_votes" ADD CONSTRAINT "dispute_votes_dispute_id_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."disputes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "disputes" ADD CONSTRAINT "disputes_tanda_id_tandas_id_fk" FOREIGN KEY ("tanda_id") REFERENCES "public"."tandas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kyc_sessions" ADD CONSTRAINT "kyc_sessions_user_wallet_users_wallet_fk" FOREIGN KEY ("user_wallet") REFERENCES "public"."users"("wallet") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "loan_cosigners" ADD CONSTRAINT "loan_cosigners_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "loans" ADD CONSTRAINT "loans_tanda_backing_tandas_id_fk" FOREIGN KEY ("tanda_backing") REFERENCES "public"."tandas"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "members" ADD CONSTRAINT "members_tanda_id_tandas_id_fk" FOREIGN KEY ("tanda_id") REFERENCES "public"."tandas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "members" ADD CONSTRAINT "members_user_wallet_users_wallet_fk" FOREIGN KEY ("user_wallet") REFERENCES "public"."users"("wallet") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tandas" ADD CONSTRAINT "tandas_creator_wallet_users_wallet_fk" FOREIGN KEY ("creator_wallet") REFERENCES "public"."users"("wallet") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "badges_user_wallet_idx" ON "badges" USING btree ("user_wallet");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_phone_hash_idx" ON "conversations" USING btree ("phone_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_user_wallet_idx" ON "conversations" USING btree ("user_wallet");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dispute_votes_dispute_voter_uidx" ON "dispute_votes" USING btree ("dispute_id","voter_wallet");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "disputes_state_idx" ON "disputes" USING btree ("state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "disputes_deadline_ts_idx" ON "disputes" USING btree ("deadline_ts");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idempotency_keys_expires_at_idx" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kyc_sessions_applicant_id_idx" ON "kyc_sessions" USING btree ("applicant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kyc_sessions_user_wallet_idx" ON "kyc_sessions" USING btree ("user_wallet");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "loans_borrower_wallet_idx" ON "loans" USING btree ("borrower_wallet");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "loans_state_idx" ON "loans" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "members_tanda_user_uidx" ON "members" USING btree ("tanda_id","user_wallet");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "members_tanda_turn_uidx" ON "members" USING btree ("tanda_id","turn_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ramps_provider_ref_idx" ON "ramps" USING btree ("provider_ref") WHERE provider_ref IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tandas_state_idx" ON "tandas" USING btree ("state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tandas_creator_wallet_idx" ON "tandas" USING btree ("creator_wallet");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_phone_hash_idx" ON "users" USING btree ("phone_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_country_code_idx" ON "users" USING btree ("country_code");