ALTER TABLE "automations" ALTER COLUMN "health_checked_at" SET DATA TYPE bigint USING "health_checked_at"::bigint;--> statement-breakpoint
ALTER TABLE "project_errors" ALTER COLUMN "count" SET DATA TYPE bigint USING "count"::bigint;--> statement-breakpoint
ALTER TABLE "sigil_error_groups" ALTER COLUMN "count" SET DATA TYPE bigint USING "count"::bigint;