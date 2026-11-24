-- alepha-allow-drop-table: agent automations become triggers on prompts (#Q4277); a leaf (host_jobs.automation_id was a soft reference), no data migration
DROP TABLE "agent_automations";--> statement-breakpoint
ALTER TABLE "projects" RENAME COLUMN "automations_paused_at" TO "prompts_paused_at";--> statement-breakpoint
DROP INDEX "host_jobs_automation_id_status_idx";--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "event_keys" text[];--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "settle_seconds" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "pending_job_id" uuid;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "schedule" text;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "daily_hour" integer;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "weekday" integer;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "next_run_at" text;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "check" text[];--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "arg_values" jsonb;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "max_runs_per_hour" integer DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "max_runs_per_day" integer DEFAULT 48 NOT NULL;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "consecutive_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "last_job_id" uuid;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "last_run_at" text;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "last_skipped_at" text;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "last_skipped_reason" text;--> statement-breakpoint
ALTER TABLE "host_jobs" DROP COLUMN "automation_id";--> statement-breakpoint
ALTER TABLE "project_thresholds" DROP COLUMN "automation_builds_per_day";--> statement-breakpoint
CREATE INDEX "prompts_next_run_at_idx" ON "prompts" ("next_run_at");