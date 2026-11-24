ALTER TABLE "agent_automations" ADD COLUMN "auto_merge" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_automations" ADD COLUMN "concurrency" integer DEFAULT 1 NOT NULL;