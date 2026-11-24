CREATE TABLE "prompts" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"project_id" integer NOT NULL,
	"name" text NOT NULL,
	"builtin" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"title" text,
	"description" text,
	"text" text,
	"args" jsonb,
	"source" text,
	"ref" text,
	"host" text,
	"agent" text,
	"model" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "prompts_project_id_name_idx" ON "prompts" ("project_id","name");--> statement-breakpoint
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
-- Prompts (#E174, #Q4274): `automation:manage` becomes `prompt:manage`, and
-- `automation:*` `prompt:*`, in ranks and API keys.
UPDATE "organization_ranks" SET "permissions" = array_replace(array_replace("permissions", 'automation:manage', 'prompt:manage'), 'automation:*', 'prompt:*')
WHERE 'automation:manage' = ANY("permissions") OR 'automation:*' = ANY("permissions");--> statement-breakpoint
UPDATE "api_keys" SET "permissions" = array_replace(array_replace("permissions", 'automation:manage', 'prompt:manage'), 'automation:*', 'prompt:*')
WHERE 'automation:manage' = ANY("permissions") OR 'automation:*' = ANY("permissions");
