ALTER TABLE "agent_automations" ADD COLUMN "event_keys" text[];--> statement-breakpoint
ALTER TABLE "agent_automations" ADD COLUMN "settle_seconds" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_automations" ADD COLUMN "pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_automations" ADD COLUMN "pending_job_id" uuid;--> statement-breakpoint
ALTER TABLE "project_events" ADD COLUMN "job_id" uuid;