ALTER TABLE "prompts" ADD COLUMN "settle_seconds" integer;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "pending_job_id" uuid;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "pending_event" text;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "pending_at" text;