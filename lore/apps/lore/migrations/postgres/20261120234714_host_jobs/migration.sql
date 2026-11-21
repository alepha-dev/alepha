CREATE TABLE "host_job_logs" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"job_id" uuid NOT NULL,
	"stream" text NOT NULL,
	"offset" integer NOT NULL,
	"data" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "host_jobs" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"project_id" integer NOT NULL,
	"host_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"input" jsonb NOT NULL,
	"started_by" uuid,
	"started_by_job_id" uuid,
	"subject_type" text,
	"subject_id" text,
	"command_id" uuid,
	"queued_at" text NOT NULL,
	"started_at" text,
	"ended_at" text,
	"reason" text,
	"exit_code" integer,
	"log_file_id" uuid,
	"log_bytes" integer,
	"log_truncated" boolean,
	"result" jsonb,
	"retries" integer,
	"retry_at" text
);
--> statement-breakpoint
ALTER TABLE "hosts" ADD COLUMN "jobs_allowed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "host_job_logs_job_id_stream_offset_idx" ON "host_job_logs" ("job_id","stream","offset");--> statement-breakpoint
CREATE INDEX "host_jobs_host_id_status_queued_at_idx" ON "host_jobs" ("host_id","status","queued_at");--> statement-breakpoint
CREATE INDEX "host_jobs_project_id_queued_at_idx" ON "host_jobs" ("project_id","queued_at");--> statement-breakpoint
CREATE INDEX "host_jobs_command_id_idx" ON "host_jobs" ("command_id");--> statement-breakpoint
ALTER TABLE "host_job_logs" ADD CONSTRAINT "host_job_logs_job_id_host_jobs_id_fkey" FOREIGN KEY ("job_id") REFERENCES "host_jobs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "host_jobs" ADD CONSTRAINT "host_jobs_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "host_jobs" ADD CONSTRAINT "host_jobs_host_id_hosts_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "host_jobs" ADD CONSTRAINT "host_jobs_started_by_users_id_fkey" FOREIGN KEY ("started_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "host_jobs" ADD CONSTRAINT "host_jobs_command_id_host_commands_id_fkey" FOREIGN KEY ("command_id") REFERENCES "host_commands"("id") ON DELETE SET NULL;