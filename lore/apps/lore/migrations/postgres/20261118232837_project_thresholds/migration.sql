CREATE TABLE "project_thresholds" (
	"id" uuid PRIMARY KEY,
	"project_id" integer NOT NULL,
	"coverage_min" double precision,
	"coverage_armed" boolean,
	"open_errors_max" integer,
	"errors_armed" boolean
);
--> statement-breakpoint
CREATE UNIQUE INDEX "project_thresholds_project_id_idx" ON "project_thresholds" ("project_id");--> statement-breakpoint
ALTER TABLE "project_thresholds" ADD CONSTRAINT "project_thresholds_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;