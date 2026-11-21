CREATE TABLE "job_keys" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"api_key_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"project_id" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"tools" text[] NOT NULL,
	"quest_number" integer,
	"feedback_number" integer,
	"repository_id" text,
	"write_ref_prefix" text,
	"expires_at" text NOT NULL,
	"revoked_at" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "job_keys_api_key_id_idx" ON "job_keys" ("api_key_id");--> statement-breakpoint
CREATE INDEX "job_keys_job_id_idx" ON "job_keys" ("job_id");--> statement-breakpoint
ALTER TABLE "job_keys" ADD CONSTRAINT "job_keys_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;