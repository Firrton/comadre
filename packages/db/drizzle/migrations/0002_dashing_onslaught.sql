CREATE TYPE "public"."savings_action_status" AS ENUM('pending', 'confirmed', 'cancelled', 'expired', 'failed');--> statement-breakpoint
CREATE TYPE "public"."savings_action_type" AS ENUM('deposit', 'withdraw');--> statement-breakpoint
CREATE TYPE "public"."savings_position_status" AS ENUM('active', 'closed');--> statement-breakpoint
CREATE TYPE "public"."savings_provider" AS ENUM('mock', 'kamino');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contact_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_wallet" text NOT NULL,
	"phone_hash" text NOT NULL,
	"phone_ciphertext" text NOT NULL,
	"channel" "channel" DEFAULT 'whatsapp' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "savings_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_wallet" text NOT NULL,
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
	"user_wallet" text NOT NULL,
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
	"user_wallet" text NOT NULL,
	"provider" "savings_provider" DEFAULT 'mock' NOT NULL,
	"strategy_id" text NOT NULL,
	"deposited_micro_usdc" bigint NOT NULL,
	"share_amount" text DEFAULT '0' NOT NULL,
	"last_known_underlying_micro_usdc" bigint NOT NULL,
	"status" "savings_position_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_routes" ADD CONSTRAINT "contact_routes_user_wallet_users_wallet_fk" FOREIGN KEY ("user_wallet") REFERENCES "public"."users"("wallet") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "savings_actions" ADD CONSTRAINT "savings_actions_user_wallet_users_wallet_fk" FOREIGN KEY ("user_wallet") REFERENCES "public"."users"("wallet") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "savings_nudges" ADD CONSTRAINT "savings_nudges_user_wallet_users_wallet_fk" FOREIGN KEY ("user_wallet") REFERENCES "public"."users"("wallet") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "savings_positions" ADD CONSTRAINT "savings_positions_user_wallet_users_wallet_fk" FOREIGN KEY ("user_wallet") REFERENCES "public"."users"("wallet") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contact_routes_wallet_channel_uidx" ON "contact_routes" USING btree ("user_wallet","channel");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_routes_phone_hash_idx" ON "contact_routes" USING btree ("phone_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "savings_actions_wallet_idx" ON "savings_actions" USING btree ("user_wallet");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "savings_actions_status_idx" ON "savings_actions" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "savings_actions_expires_idx" ON "savings_actions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "savings_nudges_source_ref_uidx" ON "savings_nudges" USING btree ("source","source_ref");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "savings_nudges_wallet_idx" ON "savings_nudges" USING btree ("user_wallet");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "savings_nudges_status_idx" ON "savings_nudges" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "savings_positions_wallet_strategy_uidx" ON "savings_positions" USING btree ("user_wallet","provider","strategy_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "savings_positions_wallet_idx" ON "savings_positions" USING btree ("user_wallet");