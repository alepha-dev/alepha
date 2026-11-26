ALTER TABLE "host_jobs" ADD COLUMN "steps" jsonb;--> statement-breakpoint
ALTER TABLE "quests" ADD COLUMN "worked_by_job_id" uuid;--> statement-breakpoint
CREATE INDEX "quests_project_id_worked_by_job_id_idx" ON "quests" ("project_id","worked_by_job_id");