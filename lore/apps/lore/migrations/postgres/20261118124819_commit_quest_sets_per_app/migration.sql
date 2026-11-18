DROP INDEX "commit_quest_sets_project_id_commit_sha_idx";--> statement-breakpoint
ALTER TABLE "commit_quest_sets" ADD COLUMN "app" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "commit_quest_sets" ADD COLUMN "paths" text;--> statement-breakpoint
CREATE UNIQUE INDEX "commit_quest_sets_project_id_commit_sha_app_idx" ON "commit_quest_sets" ("project_id","commit_sha","app");