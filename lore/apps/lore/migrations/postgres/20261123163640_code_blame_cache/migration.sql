CREATE TABLE "code_blame_cache" (
	"id" uuid PRIMARY KEY,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"repository_id" uuid NOT NULL,
	"commit_sha" text NOT NULL,
	"path" text NOT NULL,
	"status" text NOT NULL,
	"ranges" jsonb NOT NULL,
	"stopped_at_sha" text,
	"steps" integer NOT NULL,
	"state" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "code_blame_cache_repository_id_commit_sha_path_idx" ON "code_blame_cache" ("repository_id","commit_sha","path");--> statement-breakpoint
ALTER TABLE "code_blame_cache" ADD CONSTRAINT "code_blame_cache_repository_id_code_repositories_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "code_repositories"("id") ON DELETE RESTRICT;