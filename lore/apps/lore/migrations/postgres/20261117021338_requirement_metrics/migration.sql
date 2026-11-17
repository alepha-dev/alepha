CREATE TABLE "requirement_metric_days" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "requirement_metric_days_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"project_id" integer NOT NULL,
	"requirement_id" integer NOT NULL,
	"day" text NOT NULL,
	"value" double precision,
	"status" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "requirements" ADD COLUMN "metric" jsonb;--> statement-breakpoint
ALTER TABLE "requirements" ADD COLUMN "metric_value" double precision;--> statement-breakpoint
ALTER TABLE "requirements" ADD COLUMN "metric_status" text;--> statement-breakpoint
ALTER TABLE "requirements" ADD COLUMN "metric_status_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "requirements" ADD COLUMN "metric_evaluated_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "requirement_metric_days_requirement_id_day_idx" ON "requirement_metric_days" ("requirement_id","day");--> statement-breakpoint
ALTER TABLE "requirement_metric_days" ADD CONSTRAINT "requirement_metric_days_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "requirement_metric_days" ADD CONSTRAINT "requirement_metric_days_requirement_id_requirements_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "requirements"("id") ON DELETE CASCADE;