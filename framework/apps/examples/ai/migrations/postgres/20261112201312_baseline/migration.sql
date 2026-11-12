CREATE TYPE "ai_messages_role_enum" AS ENUM('user', 'assistant', 'tool');--> statement-breakpoint
CREATE TYPE "job_executions_status_enum" AS ENUM('pending', 'running', 'scheduled', 'ok', 'error', 'cancelled');--> statement-breakpoint
CREATE TABLE "ai_conversations" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"title" text,
	"pending_call_id" text,
	"pending_call" jsonb
);
--> statement-breakpoint
CREATE TABLE "ai_messages" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"seq" integer NOT NULL,
	"role" "ai_messages_role_enum" NOT NULL,
	"content" text NOT NULL,
	"tool_calls" jsonb,
	"call_id" text,
	"name" text,
	"is_error" boolean,
	"vendor" jsonb,
	"model" text,
	"input_tokens" integer,
	"output_tokens" integer
);
--> statement-breakpoint
CREATE TABLE "alepha_sequences" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"scope" text DEFAULT 'default' NOT NULL,
	"value" integer NOT NULL
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
	"text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parameters" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"content" jsonb NOT NULL,
	"schema_hash" text NOT NULL,
	"activation_date" timestamp with time zone NOT NULL,
	"version" integer NOT NULL,
	"change_description" text,
	"tags" text[],
	"creator_id" uuid,
	"creator_name" text,
	"previous_content" jsonb,
	"migration_log" text
);
--> statement-breakpoint
CREATE INDEX "ai_conversations_user_id_updated_at_idx" ON "ai_conversations" ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "ai_conversations_updated_at_idx" ON "ai_conversations" ("updated_at");--> statement-breakpoint
CREATE INDEX "ai_messages_user_id_created_at_idx" ON "ai_messages" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_messages_conversation_id_seq_idx" ON "ai_messages" ("conversation_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "alepha_sequences_name_scope_idx" ON "alepha_sequences" ("name","scope");--> statement-breakpoint
CREATE INDEX "job_executions_status_scheduled_at_idx" ON "job_executions" ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "job_executions_status_updated_at_idx" ON "job_executions" ("status","updated_at");--> statement-breakpoint
CREATE INDEX "job_executions_job_name_status_scheduled_at_idx" ON "job_executions" ("job_name","status","scheduled_at");--> statement-breakpoint
CREATE INDEX "job_executions_job_name_status_created_at_idx" ON "job_executions" ("job_name","status","created_at");--> statement-breakpoint
CREATE INDEX "job_executions_job_name_started_at_idx" ON "job_executions" ("job_name","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_executions_job_name_key_idx" ON "job_executions" ("job_name","key");--> statement-breakpoint
CREATE INDEX "parameters_name_activation_date_idx" ON "parameters" ("name","activation_date");--> statement-breakpoint
CREATE UNIQUE INDEX "parameters_name_version_idx" ON "parameters" ("name","version");--> statement-breakpoint
CREATE INDEX "parameters_activation_date_idx" ON "parameters" ("activation_date");