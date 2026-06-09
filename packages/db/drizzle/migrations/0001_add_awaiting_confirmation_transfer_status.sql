ALTER TYPE "public"."transfer_status" ADD VALUE IF NOT EXISTS 'awaiting_confirmation' AFTER 'awaiting_recipient';
