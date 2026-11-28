CREATE TABLE "pull_requests" (
	"id" uuid PRIMARY KEY,
	"project_id" integer NOT NULL,
	"repository_id" integer NOT NULL,
	"repository" text NOT NULL,
	"github_id" integer NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"author_login" text,
	"author_github_id" integer,
	"author_permission" text,
	"trusted_by" uuid,
	"trusted_at" text,
	"head_ref" text NOT NULL,
	"base_ref" text NOT NULL,
	"head_sha" text NOT NULL,
	"state" text NOT NULL,
	"queued" boolean,
	"checks" text NOT NULL,
	"review" text NOT NULL,
	"mergeable_state" text,
	"suites" jsonb,
	"statuses" jsonb,
	"failing_checks" jsonb,
	"merged_at" text,
	"closed_at" text,
	"github_updated_at" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "pull_requests_repository_id_number_idx" ON "pull_requests" ("repository_id","number");--> statement-breakpoint
CREATE INDEX "pull_requests_project_id_state_idx" ON "pull_requests" ("project_id","state");--> statement-breakpoint
CREATE INDEX "pull_requests_project_id_head_ref_idx" ON "pull_requests" ("project_id","head_ref");--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_trusted_by_users_id_fkey" FOREIGN KEY ("trusted_by") REFERENCES "users"("id") ON DELETE SET NULL;