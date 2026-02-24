CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"token_suffix" text NOT NULL,
	"roles" text[] DEFAULT '{}' NOT NULL,
	"last_used_at" timestamp with time zone,
	"last_used_ip" text,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audits" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audits_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"type" text NOT NULL,
	"action" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"user_id" uuid,
	"user_realm" text,
	"user_email" text,
	"resource_type" text,
	"resource_id" text,
	"description" text,
	"metadata" jsonb,
	"ip_address" text,
	"user_agent" text,
	"session_id" uuid,
	"request_id" text,
	"success" boolean DEFAULT true NOT NULL,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "characters_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" integer NOT NULL,
	"xp" integer NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"owner" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
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
	"size" numeric NOT NULL,
	"mime_type" text NOT NULL,
	"tags" text[],
	"checksum" text
);
--> statement-breakpoint
CREATE TABLE "identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"password" text,
	"provider" text NOT NULL,
	"provider_user_id" text,
	"provider_data" jsonb
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"project_id" integer NOT NULL,
	"invited_by" uuid NOT NULL,
	"invited_email" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_execution_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"logs" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"job_name" text NOT NULL,
	"key" text,
	"payload" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"priority" integer DEFAULT 2 NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 1 NOT NULL,
	"scheduled_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"result" jsonb,
	"error" text,
	"worker_id" text,
	"triggered_by" text,
	"triggered_by_name" text,
	"cancelled_by" text,
	"cancelled_by_name" text
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "projects_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"title" text NOT NULL,
	"created_by" uuid NOT NULL,
	"public" boolean,
	"packages" text[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"refresh_token" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" text,
	"user_agent" jsonb
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tasks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"package" text NOT NULL,
	"priority" text NOT NULL,
	"complexity" integer NOT NULL,
	"accepted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"objectives" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"project_id" integer NOT NULL,
	"created_by" uuid NOT NULL,
	"accepted_by" uuid,
	"completed_by" uuid,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"timer_sessions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attachments" text[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"realm" text DEFAULT 'default' NOT NULL,
	"username" text,
	"email" text,
	"phone_number" text,
	"roles" text[] DEFAULT '{}' NOT NULL,
	"first_name" text,
	"last_name" text,
	"picture" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "verification_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"type" text NOT NULL,
	"target" text NOT NULL,
	"code" text NOT NULL,
	"verified_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whiteboards" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "whiteboards_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"title" text NOT NULL,
	"project_id" integer NOT NULL,
	"created_by" uuid NOT NULL,
	"data" jsonb DEFAULT '{"elements":[]}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identities" ADD CONSTRAINT "identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whiteboards" ADD CONSTRAINT "whiteboards_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whiteboards" ADD CONSTRAINT "whiteboards_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_user_id_name_idx" ON "api_keys" USING btree ("user_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_token_hash_idx" ON "api_keys" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "audits_created_at_idx" ON "audits" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audits_type_idx" ON "audits" USING btree ("type");--> statement-breakpoint
CREATE INDEX "audits_action_idx" ON "audits" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audits_user_id_idx" ON "audits" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audits_user_realm_idx" ON "audits" USING btree ("user_realm");--> statement-breakpoint
CREATE INDEX "audits_resource_type_idx" ON "audits" USING btree ("resource_type");--> statement-breakpoint
CREATE INDEX "audits_resource_id_idx" ON "audits" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "audits_severity_idx" ON "audits" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "audits_type_action_idx" ON "audits" USING btree ("type","action");--> statement-breakpoint
CREATE INDEX "audits_user_id_created_at_idx" ON "audits" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "audits_user_realm_created_at_idx" ON "audits" USING btree ("user_realm","created_at");--> statement-breakpoint
CREATE INDEX "files_expiration_date_idx" ON "files" USING btree ("expiration_date");--> statement-breakpoint
CREATE INDEX "files_bucket_idx" ON "files" USING btree ("bucket");--> statement-breakpoint
CREATE INDEX "files_creator_idx" ON "files" USING btree ("creator");--> statement-breakpoint
CREATE INDEX "files_created_at_idx" ON "files" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "files_mime_type_idx" ON "files" USING btree ("mime_type");--> statement-breakpoint
CREATE INDEX "files_bucket_created_at_idx" ON "files" USING btree ("bucket","created_at");--> statement-breakpoint
CREATE INDEX "identities_user_id_idx" ON "identities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "identities_provider_idx" ON "identities" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "identities_user_id_provider_idx" ON "identities" USING btree ("user_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "identities_provider_provider_user_id_idx" ON "identities" USING btree ("provider","provider_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_project_id_invited_email_idx" ON "invitations" USING btree ("project_id","invited_email");--> statement-breakpoint
CREATE INDEX "job_executions_job_name_status_priority_scheduled_at_idx" ON "job_executions" USING btree ("job_name","status","priority","scheduled_at");--> statement-breakpoint
CREATE INDEX "job_executions_job_name_status_started_at_idx" ON "job_executions" USING btree ("job_name","status","started_at");--> statement-breakpoint
CREATE INDEX "job_executions_job_name_completed_at_idx" ON "job_executions" USING btree ("job_name","completed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_executions_job_name_key_idx" ON "job_executions" USING btree ("job_name","key");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_refresh_token_idx" ON "sessions" USING btree ("refresh_token");--> statement-breakpoint
CREATE INDEX "tasks_project_id_deleted_at_idx" ON "tasks" USING btree ("project_id","deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_realm_username_idx" ON "users" USING btree ("realm","username");--> statement-breakpoint
CREATE UNIQUE INDEX "users_realm_email_idx" ON "users" USING btree ("realm","email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_realm_phone_number_idx" ON "users" USING btree ("realm","phone_number");--> statement-breakpoint
CREATE INDEX "verification_created_at_idx" ON "verification" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "verification_target_code_idx" ON "verification" USING btree ("target","code");--> statement-breakpoint
CREATE INDEX "whiteboards_project_id_deleted_at_idx" ON "whiteboards" USING btree ("project_id","deleted_at");