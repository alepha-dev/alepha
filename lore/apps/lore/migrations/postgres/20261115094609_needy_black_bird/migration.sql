CREATE TABLE "project_exclusions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "project_exclusions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"project_id" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"excluded_by" uuid NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "project_exclusions_project_id_user_id_idx" ON "project_exclusions" ("project_id","user_id");--> statement-breakpoint
ALTER TABLE "project_exclusions" ADD CONSTRAINT "project_exclusions_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;