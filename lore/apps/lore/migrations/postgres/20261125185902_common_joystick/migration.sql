CREATE TABLE "prompt_queue" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"project_id" integer NOT NULL,
	"prompt" text NOT NULL,
	"key" text NOT NULL,
	"args" jsonb,
	"host" text,
	"agent" text,
	"model" text,
	"user_id" uuid,
	"cause" jsonb NOT NULL,
	"started_by_job_id" uuid
);
--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "concurrency" text;--> statement-breakpoint
ALTER TABLE "prompts" DROP COLUMN "settle_seconds";--> statement-breakpoint
ALTER TABLE "prompts" DROP COLUMN "pending";--> statement-breakpoint
ALTER TABLE "prompts" DROP COLUMN "pending_job_id";--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_queue_project_id_prompt_key_idx" ON "prompt_queue" ("project_id","prompt","key");--> statement-breakpoint
ALTER TABLE "prompt_queue" ADD CONSTRAINT "prompt_queue_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "prompt_queue" ADD CONSTRAINT "prompt_queue_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;