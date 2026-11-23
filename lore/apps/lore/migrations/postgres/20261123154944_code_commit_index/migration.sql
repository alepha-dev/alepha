CREATE TABLE "code_commit_parents" (
	"id" uuid PRIMARY KEY,
	"repository_id" uuid NOT NULL,
	"sha" text NOT NULL,
	"parent_sha" text NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "code_commit_paths" (
	"id" uuid PRIMARY KEY,
	"repository_id" uuid NOT NULL,
	"commit_sha" text NOT NULL,
	"path" text NOT NULL,
	"old_path" text,
	"kind" text NOT NULL,
	"old_blob_sha" text,
	"new_blob_sha" text
);
--> statement-breakpoint
CREATE TABLE "code_commits" (
	"id" uuid PRIMARY KEY,
	"repository_id" uuid NOT NULL,
	"sha" text NOT NULL,
	"first_parent" text,
	"parents" text[] NOT NULL,
	"tree_sha" text NOT NULL,
	"author_name" text NOT NULL,
	"author_email" text NOT NULL,
	"authored_at" integer NOT NULL,
	"committer_name" text NOT NULL,
	"committer_email" text NOT NULL,
	"committed_at" integer NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "code_commit_parents_repository_id_sha_parent_sha_idx" ON "code_commit_parents" ("repository_id","sha","parent_sha");--> statement-breakpoint
CREATE INDEX "code_commit_parents_repository_id_parent_sha_idx" ON "code_commit_parents" ("repository_id","parent_sha");--> statement-breakpoint
CREATE UNIQUE INDEX "code_commit_paths_repository_id_commit_sha_path_idx" ON "code_commit_paths" ("repository_id","commit_sha","path");--> statement-breakpoint
CREATE INDEX "code_commit_paths_repository_id_path_idx" ON "code_commit_paths" ("repository_id","path");--> statement-breakpoint
CREATE UNIQUE INDEX "code_commits_repository_id_sha_idx" ON "code_commits" ("repository_id","sha");--> statement-breakpoint
CREATE INDEX "code_commits_repository_id_committed_at_idx" ON "code_commits" ("repository_id","committed_at");--> statement-breakpoint
ALTER TABLE "code_commit_parents" ADD CONSTRAINT "code_commit_parents_repository_id_code_repositories_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "code_repositories"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "code_commit_paths" ADD CONSTRAINT "code_commit_paths_repository_id_code_repositories_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "code_repositories"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "code_commits" ADD CONSTRAINT "code_commits_repository_id_code_repositories_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "code_repositories"("id") ON DELETE RESTRICT;