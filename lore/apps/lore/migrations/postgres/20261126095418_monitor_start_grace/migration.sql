ALTER TABLE "monitors" ADD COLUMN "grace_host" text;--> statement-breakpoint
ALTER TABLE "monitors" ADD COLUMN "grace_unit" text;--> statement-breakpoint
ALTER TABLE "monitors" ADD COLUMN "grace_secs" integer DEFAULT 1500 NOT NULL;