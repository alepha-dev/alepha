CREATE TABLE "chat_lore_engines" (
	"id" uuid PRIMARY KEY,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"project_id" integer NOT NULL,
	"engine" text DEFAULT 'api' NOT NULL,
	"engine_host" text,
	"engine_agent" text,
	"engine_model" text
);
--> statement-breakpoint
ALTER TABLE "chat_agents" ADD COLUMN "engine" text DEFAULT 'api' NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_agents" ADD COLUMN "engine_host" text;--> statement-breakpoint
ALTER TABLE "chat_agents" ADD COLUMN "engine_agent" text;--> statement-breakpoint
ALTER TABLE "chat_agents" ADD COLUMN "engine_model" text;--> statement-breakpoint
ALTER TABLE "chat_room_members" ADD COLUMN "host_sessions" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_lore_engines_project_id_idx" ON "chat_lore_engines" ("project_id");--> statement-breakpoint
ALTER TABLE "chat_lore_engines" ADD CONSTRAINT "chat_lore_engines_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;