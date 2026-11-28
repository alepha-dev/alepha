CREATE TABLE "project_repositories" (
	"id" uuid PRIMARY KEY,
	"project_id" integer NOT NULL,
	"installation_id" integer NOT NULL,
	"repository_id" integer NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"default_branch" text NOT NULL,
	"former_names" text[],
	"connected_by" uuid,
	"connected_by_github_id" integer,
	"connected_at" text NOT NULL,
	"disconnected_at" text,
	"disconnect_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "github_states" ADD COLUMN "installation_id" integer;--> statement-breakpoint
ALTER TABLE "github_states" ADD COLUMN "repository_ids" integer[];--> statement-breakpoint
ALTER TABLE "github_states" ADD COLUMN "github_user_id" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "project_repositories_project_id_idx" ON "project_repositories" ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_repositories_repository_id_idx" ON "project_repositories" ("repository_id");--> statement-breakpoint
CREATE INDEX "project_repositories_installation_id_idx" ON "project_repositories" ("installation_id");--> statement-breakpoint
ALTER TABLE "project_repositories" ADD CONSTRAINT "project_repositories_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "project_repositories" ADD CONSTRAINT "project_repositories_connected_by_users_id_fkey" FOREIGN KEY ("connected_by") REFERENCES "users"("id") ON DELETE SET NULL;