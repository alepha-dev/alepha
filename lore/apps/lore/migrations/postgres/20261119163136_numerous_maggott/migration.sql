CREATE TABLE "code_repositories" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"project_id" integer NOT NULL,
	"slug" text NOT NULL,
	"default_branch" text DEFAULT 'main' NOT NULL,
	"backend_ref" text NOT NULL,
	"created_by" uuid,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "code_repositories_project_id_slug_idx" ON "code_repositories" ("project_id","slug");--> statement-breakpoint
ALTER TABLE "code_repositories" ADD CONSTRAINT "code_repositories_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "code_repositories" ADD CONSTRAINT "code_repositories_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;