CREATE TYPE "job_executions_status_enum" AS ENUM('pending', 'running', 'scheduled', 'ok', 'error', 'cancelled');--> statement-breakpoint
CREATE TABLE "alepha_sequences" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"scope" text DEFAULT 'default' NOT NULL,
	"value" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"blob_id" text NOT NULL,
	"creator" uuid,
	"creator_realm" text,
	"creator_name" text,
	"bucket" text NOT NULL,
	"expiration_date" timestamp with time zone,
	"name" text NOT NULL,
	"original_name" text,
	"size" double precision NOT NULL,
	"mime_type" text NOT NULL,
	"tags" text[],
	"checksum" text
);
--> statement-breakpoint
CREATE TABLE "job_cron_claims" (
	"id" text PRIMARY KEY,
	"job_name" text NOT NULL,
	"instant" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_executions" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"job_name" text NOT NULL,
	"key" text,
	"status" "job_executions_status_enum" DEFAULT 'pending'::"job_executions_status_enum" NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 1 NOT NULL,
	"redispatch_count" integer DEFAULT 0 NOT NULL,
	"payload" jsonb,
	"scheduled_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error" text,
	"logs" jsonb,
	"steps" jsonb,
	"triggered_by" text,
	"triggered_by_name" text,
	"cancelled_by" text,
	"cancelled_by_name" text
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"label" text NOT NULL,
	"file_id" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "alepha_sequences_name_scope_idx" ON "alepha_sequences" ("name","scope");--> statement-breakpoint
CREATE INDEX "files_expiration_date_idx" ON "files" ("expiration_date");--> statement-breakpoint
CREATE INDEX "files_bucket_idx" ON "files" ("bucket");--> statement-breakpoint
CREATE INDEX "files_creator_idx" ON "files" ("creator");--> statement-breakpoint
CREATE INDEX "files_created_at_idx" ON "files" ("created_at");--> statement-breakpoint
CREATE INDEX "files_mime_type_idx" ON "files" ("mime_type");--> statement-breakpoint
CREATE INDEX "files_bucket_created_at_idx" ON "files" ("bucket","created_at");--> statement-breakpoint
CREATE INDEX "job_executions_status_scheduled_at_idx" ON "job_executions" ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "job_executions_status_updated_at_idx" ON "job_executions" ("status","updated_at");--> statement-breakpoint
CREATE INDEX "job_executions_job_name_status_scheduled_at_idx" ON "job_executions" ("job_name","status","scheduled_at");--> statement-breakpoint
CREATE INDEX "job_executions_job_name_status_created_at_idx" ON "job_executions" ("job_name","status","created_at");--> statement-breakpoint
CREATE INDEX "job_executions_job_name_started_at_idx" ON "job_executions" ("job_name","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_executions_job_name_key_idx" ON "job_executions" ("job_name","key");