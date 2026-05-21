-- Add 'neverland' value to savings_provider enum
ALTER TYPE "savings_provider" ADD VALUE IF NOT EXISTS 'neverland';
--> statement-breakpoint
-- Add principal_withdrawn_micro_usdc column to savings_positions
ALTER TABLE "savings_positions" ADD COLUMN IF NOT EXISTS "principal_withdrawn_micro_usdc" BIGINT NOT NULL DEFAULT 0;
