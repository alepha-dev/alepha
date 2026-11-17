CREATE TABLE "requirements_coverage_days" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "requirements_coverage_days_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"project_id" integer NOT NULL,
	"day" text NOT NULL,
	"scope" text NOT NULL,
	"verified" integer NOT NULL,
	"covered" integer NOT NULL,
	"total" integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "requirements_coverage_days_project_id_scope_day_idx" ON "requirements_coverage_days" ("project_id","scope","day");--> statement-breakpoint
ALTER TABLE "requirements_coverage_days" ADD CONSTRAINT "requirements_coverage_days_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;