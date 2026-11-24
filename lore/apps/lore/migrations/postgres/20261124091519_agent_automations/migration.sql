CREATE TABLE "agent_automations" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"project_id" integer NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"prompt_kind" text NOT NULL,
	"prompt_text" text,
	"host" text,
	"agent" text,
	"model" text,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"only_if_work" boolean DEFAULT false NOT NULL,
	"last_job_id" uuid,
	"last_run_at" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "host_jobs" ADD COLUMN "automation_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_automations_project_id_name_idx" ON "agent_automations" ("project_id","name");--> statement-breakpoint
CREATE INDEX "host_jobs_automation_id_status_idx" ON "host_jobs" ("automation_id","status");--> statement-breakpoint
ALTER TABLE "agent_automations" ADD CONSTRAINT "agent_automations_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agent_automations" ADD CONSTRAINT "agent_automations_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
-- Agent automations (#Q4226): an Admin rank stored after the snapshot
-- cutoff (#Q3920) holds every permission of its day, so it gains
-- `automation:manage` as the default Admin does. One that dropped
-- `host:update` was narrowed on purpose and is left alone.
UPDATE "organization_ranks" SET "permissions" = array_append("permissions", 'automation:manage')
WHERE "key" = 'admin' AND 'host:update' = ANY("permissions") AND NOT 'automation:manage' = ANY("permissions");
