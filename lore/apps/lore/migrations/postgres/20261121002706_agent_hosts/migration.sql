ALTER TABLE "hosts" ADD COLUMN "agent_host" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "hosts" ADD COLUMN "agent_status" text;--> statement-breakpoint
ALTER TABLE "hosts" ADD COLUMN "agent_checked_at" text;--> statement-breakpoint
ALTER TABLE "hosts" ADD COLUMN "agent_error" text;--> statement-breakpoint
ALTER TABLE "hosts" ADD COLUMN "agent_cli_version" text;--> statement-breakpoint
ALTER TABLE "hosts" ADD COLUMN "agent_model" text;--> statement-breakpoint
ALTER TABLE "hosts" ADD COLUMN "agent_credential" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "default_agent_host_id" uuid;