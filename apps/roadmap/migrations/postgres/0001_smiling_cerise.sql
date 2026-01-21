DROP TABLE "task_votes" CASCADE;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "attachments" text[] DEFAULT '{}' NOT NULL;