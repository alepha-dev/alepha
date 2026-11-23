ALTER TABLE "epics" ADD COLUMN "agent_review_job_id" uuid;--> statement-breakpoint
ALTER TABLE "job_keys" ADD COLUMN "epic_number" integer;