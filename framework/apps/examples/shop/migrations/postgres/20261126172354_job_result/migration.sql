ALTER TABLE "job_executions" ADD COLUMN "result" jsonb;--> statement-breakpoint
ALTER TABLE "job_executions" ADD COLUMN "expires_at" timestamp with time zone;