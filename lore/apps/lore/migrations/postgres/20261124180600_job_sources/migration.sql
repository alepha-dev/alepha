ALTER TABLE "agent_automations" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "agent_automations" ADD COLUMN "ref" text;--> statement-breakpoint
ALTER TABLE "host_jobs" ADD COLUMN "commit" text;--> statement-breakpoint
ALTER TABLE "host_jobs" ADD COLUMN "warning" text;--> statement-breakpoint
ALTER TABLE "hosts" ADD COLUMN "jobs_sources" boolean;