-- Chat agents (#E170, #Q4196): `chat:agent` reaches the stored ranks and
-- API keys that hold `chat:manage` (the Admin), as `chat_permissions` did for
-- the first three: stored rows are never reseeded. `chat:*` already covers it.
CREATE TABLE "chat_agents" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"project_id" integer NOT NULL,
	"handle" text,
	"name" text NOT NULL,
	"avatar" uuid,
	"pre_prompt" text NOT NULL,
	"model" text,
	"created_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "chat_mentions" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_agents_project_id_handle_idx" ON "chat_agents" ("project_id","handle");--> statement-breakpoint
ALTER TABLE "chat_agents" ADD CONSTRAINT "chat_agents_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "chat_agents" ADD CONSTRAINT "chat_agents_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
UPDATE "organization_ranks" SET "permissions" = array_append("permissions", 'chat:agent')
WHERE ('chat:manage' = ANY("permissions")) AND NOT 'chat:agent' = ANY("permissions");--> statement-breakpoint
UPDATE "api_keys" SET "permissions" = array_append("permissions", 'chat:agent')
WHERE ('chat:manage' = ANY("permissions")) AND NOT 'chat:agent' = ANY("permissions");
