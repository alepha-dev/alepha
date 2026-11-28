CREATE TABLE "workflow_dispatches" (
	"id" uuid PRIMARY KEY,
	"project_id" integer NOT NULL,
	"workflow_id" integer NOT NULL,
	"workflow_name" text NOT NULL,
	"ref" text NOT NULL,
	"inputs" jsonb,
	"requested_by" uuid,
	"requested_at" text NOT NULL,
	"run_id" integer,
	"run_url" text,
	"run_status" text,
	"run_conclusion" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "workflow_dispatches_project_id_requested_at_idx" ON "workflow_dispatches" ("project_id","requested_at");--> statement-breakpoint
CREATE INDEX "workflow_dispatches_project_id_run_id_idx" ON "workflow_dispatches" ("project_id","run_id");--> statement-breakpoint
ALTER TABLE "workflow_dispatches" ADD CONSTRAINT "workflow_dispatches_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "workflow_dispatches" ADD CONSTRAINT "workflow_dispatches_requested_by_users_id_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE SET NULL;