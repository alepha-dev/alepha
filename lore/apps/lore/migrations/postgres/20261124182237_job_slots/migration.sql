ALTER TABLE "host_jobs" ADD COLUMN "busy_at" text;--> statement-breakpoint
ALTER TABLE "hosts" ADD COLUMN "jobs_max_jobs" integer;--> statement-breakpoint
ALTER TABLE "hosts" ADD COLUMN "jobs_running" integer;