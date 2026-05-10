CREATE TABLE IF NOT EXISTS "user_keypairs" (
	"wallet" text PRIMARY KEY NOT NULL,
	"secret_key_b58" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_keypairs" ADD CONSTRAINT "user_keypairs_wallet_users_wallet_fk" FOREIGN KEY ("wallet") REFERENCES "public"."users"("wallet") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
