CREATE TABLE "commit_quest_sets" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"project_id" integer NOT NULL,
	"commit_sha" text NOT NULL,
	"quests" text NOT NULL,
	"complete" boolean NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "dirty" boolean;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "commit_sha" text;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "dirty" boolean;--> statement-breakpoint
CREATE UNIQUE INDEX "commit_quest_sets_project_id_commit_sha_idx" ON "commit_quest_sets" ("project_id","commit_sha");--> statement-breakpoint
ALTER TABLE "commit_quest_sets" ADD CONSTRAINT "commit_quest_sets_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;