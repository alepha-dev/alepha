ALTER TABLE "host_jobs" ADD COLUMN "prompt" text;--> statement-breakpoint
ALTER TABLE "host_jobs" ADD COLUMN "args" jsonb;--> statement-breakpoint
ALTER TABLE "host_jobs" ADD COLUMN "cause" jsonb;--> statement-breakpoint
ALTER TABLE "host_jobs" ADD COLUMN "result" text;--> statement-breakpoint
ALTER TABLE "host_jobs" ADD COLUMN "result_truncated" boolean;--> statement-breakpoint
CREATE INDEX "host_jobs_project_id_prompt_status_idx" ON "host_jobs" ("project_id","prompt","status");