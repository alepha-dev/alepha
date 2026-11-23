ALTER TABLE "project_errors" ADD COLUMN "trusted_at" text;--> statement-breakpoint
ALTER TABLE "project_errors" ADD COLUMN "trusted_by" uuid;