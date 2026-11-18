CREATE TABLE "project_events" (
	"id" uuid PRIMARY KEY,
	"project_id" integer NOT NULL,
	"name" text NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_id" text,
	"fields" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "project_events_project_id_occurred_at_idx" ON "project_events" ("project_id","occurred_at");--> statement-breakpoint
CREATE INDEX "project_events_occurred_at_idx" ON "project_events" ("occurred_at");--> statement-breakpoint
ALTER TABLE "project_events" ADD CONSTRAINT "project_events_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;