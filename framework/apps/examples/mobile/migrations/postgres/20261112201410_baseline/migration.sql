CREATE TYPE "audits_severity_enum" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "job_executions_status_enum" AS ENUM('pending', 'running', 'scheduled', 'ok', 'error', 'cancelled');--> statement-breakpoint
CREATE TYPE "ota_bundles_platform_enum" AS ENUM('ios', 'android');--> statement-breakpoint
CREATE TYPE "ota_bundles_status_enum" AS ENUM('uploading', 'ready', 'failed', 'deleted');--> statement-breakpoint
CREATE TYPE "ota_devices_platform_enum" AS ENUM('ios', 'android');--> statement-breakpoint
CREATE TYPE "verification_type_enum" AS ENUM('code', 'link');--> statement-breakpoint
CREATE TABLE "alepha_sequences" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"scope" text DEFAULT 'default' NOT NULL,
	"value" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"token_suffix" text NOT NULL,
	"roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"ip_allowlist" text[] DEFAULT '{}'::text[] NOT NULL,
	"last_used_at" timestamp with time zone,
	"last_used_ip" text,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"rotated_at" timestamp with time zone,
	"expiry_notice_sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audits" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audits_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scope_type" text,
	"scope_id" text,
	"type" text NOT NULL,
	"action" text NOT NULL,
	"severity" "audits_severity_enum" DEFAULT 'info'::"audits_severity_enum" NOT NULL,
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
	"error_message" text,
	"event_count" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "cache_entries" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"container" text NOT NULL,
	"cache_key" text NOT NULL,
	"value" text,
	"count" integer,
	"expires_at" timestamp with time zone
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
CREATE TABLE "identities" (
	"id" uuid PRIMARY KEY,
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
	"user_id" uuid NOT NULL,
	"title" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ota_apps" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"app_id" text NOT NULL,
	"name" text NOT NULL,
	"public_key" text NOT NULL,
	"key_id" text NOT NULL,
	"default_channel" text DEFAULT 'production' NOT NULL,
	"publisher_key_ids" text[] DEFAULT '{}'::text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ota_bundles" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"app_ref" uuid NOT NULL,
	"platform" "ota_bundles_platform_enum" NOT NULL,
	"variant" text NOT NULL,
	"version" text NOT NULL,
	"channel" text NOT NULL,
	"builds" text[] NOT NULL,
	"fingerprint" text NOT NULL,
	"key_id" text NOT NULL,
	"archive_sha256" text NOT NULL,
	"expanded_size" integer NOT NULL,
	"files" integer NOT NULL,
	"checksum" text NOT NULL,
	"session_key" text NOT NULL,
	"ciphertext_sha256" text NOT NULL,
	"size" integer NOT NULL,
	"status" "ota_bundles_status_enum" NOT NULL,
	"file_id" uuid,
	"killed_at" timestamp with time zone,
	"killed_reason" text,
	"last_link_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ota_channels" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"app_ref" uuid NOT NULL,
	"name" text NOT NULL,
	"allow_self_assign" boolean DEFAULT false NOT NULL,
	"cohorts" jsonb DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ota_device_overrides" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"app_ref" uuid NOT NULL,
	"device_id" text NOT NULL,
	"channel" text,
	"bundle_id" uuid,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "ota_devices" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"app_ref" uuid NOT NULL,
	"device_id" text NOT NULL,
	"platform" "ota_devices_platform_enum" NOT NULL,
	"version_code" text NOT NULL,
	"version_build" text,
	"version_name" text NOT NULL,
	"channel" text,
	"plugin_version" text,
	"is_emulator" boolean,
	"failed_versions" text[] DEFAULT '{}'::text[] NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"refresh_token" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"client_id" text,
	"scopes" text[],
	"resource" text,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"ip" text,
	"country" text,
	"user_agent" jsonb
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"realm" text DEFAULT 'users' NOT NULL,
	"username" text,
	"email" text,
	"phone_number" text,
	"roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"first_name" text,
	"last_name" text,
	"picture" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "verification_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"type" "verification_type_enum" NOT NULL,
	"target" text NOT NULL,
	"purpose" text DEFAULT 'default' NOT NULL,
	"code" text NOT NULL,
	"verified_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "alepha_sequences_name_scope_idx" ON "alepha_sequences" ("name","scope");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_user_id_name_live_idx" ON "api_keys" ("user_id","name") WHERE revoked_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_token_hash_idx" ON "api_keys" ("token_hash");--> statement-breakpoint
CREATE INDEX "audits_scope_type_scope_id_created_at_idx" ON "audits" ("scope_type","scope_id","created_at") WHERE scope_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "audits_scope_type_scope_id_user_id_created_at_idx" ON "audits" ("scope_type","scope_id","user_id","created_at") WHERE scope_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "audits_scope_type_scope_id_type_action_created_at_idx" ON "audits" ("scope_type","scope_id","type","action","created_at") WHERE scope_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "audits_scope_type_scope_id_action_created_at_idx" ON "audits" ("scope_type","scope_id","action","created_at") WHERE scope_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "audits_created_at_idx" ON "audits" ("created_at");--> statement-breakpoint
CREATE INDEX "audits_type_action_created_at_idx" ON "audits" ("type","action","created_at");--> statement-breakpoint
CREATE INDEX "audits_user_id_created_at_idx" ON "audits" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "audits_user_realm_created_at_idx" ON "audits" ("user_realm","created_at");--> statement-breakpoint
CREATE INDEX "audits_resource_type_resource_id_created_at_idx" ON "audits" ("resource_type","resource_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cache_entries_container_cache_key_idx" ON "cache_entries" ("container","cache_key");--> statement-breakpoint
CREATE INDEX "cache_entries_expires_at_idx" ON "cache_entries" ("expires_at");--> statement-breakpoint
CREATE INDEX "files_expiration_date_idx" ON "files" ("expiration_date");--> statement-breakpoint
CREATE INDEX "files_bucket_idx" ON "files" ("bucket");--> statement-breakpoint
CREATE INDEX "files_creator_idx" ON "files" ("creator");--> statement-breakpoint
CREATE INDEX "files_created_at_idx" ON "files" ("created_at");--> statement-breakpoint
CREATE INDEX "files_mime_type_idx" ON "files" ("mime_type");--> statement-breakpoint
CREATE INDEX "files_bucket_created_at_idx" ON "files" ("bucket","created_at");--> statement-breakpoint
CREATE INDEX "identities_user_id_idx" ON "identities" ("user_id");--> statement-breakpoint
CREATE INDEX "identities_provider_idx" ON "identities" ("provider");--> statement-breakpoint
CREATE INDEX "identities_user_id_provider_idx" ON "identities" ("user_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "identities_provider_provider_user_id_idx" ON "identities" ("provider","provider_user_id");--> statement-breakpoint
CREATE INDEX "job_executions_status_scheduled_at_idx" ON "job_executions" ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "job_executions_status_updated_at_idx" ON "job_executions" ("status","updated_at");--> statement-breakpoint
CREATE INDEX "job_executions_job_name_status_scheduled_at_idx" ON "job_executions" ("job_name","status","scheduled_at");--> statement-breakpoint
CREATE INDEX "job_executions_job_name_status_created_at_idx" ON "job_executions" ("job_name","status","created_at");--> statement-breakpoint
CREATE INDEX "job_executions_job_name_started_at_idx" ON "job_executions" ("job_name","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_executions_job_name_key_idx" ON "job_executions" ("job_name","key");--> statement-breakpoint
CREATE UNIQUE INDEX "ota_apps_app_id_idx" ON "ota_apps" ("app_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ota_bundles_app_ref_platform_version_idx" ON "ota_bundles" ("app_ref","platform","version");--> statement-breakpoint
CREATE UNIQUE INDEX "ota_channels_app_ref_name_idx" ON "ota_channels" ("app_ref","name");--> statement-breakpoint
CREATE UNIQUE INDEX "ota_device_overrides_app_ref_device_id_idx" ON "ota_device_overrides" ("app_ref","device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ota_devices_app_ref_device_id_idx" ON "ota_devices" ("app_ref","device_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_refresh_token_idx" ON "sessions" ("refresh_token");--> statement-breakpoint
CREATE UNIQUE INDEX "users_realm_username_ci_idx" ON "users" ("realm",LOWER("username"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_realm_email_idx" ON "users" ("realm","email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_realm_phone_number_idx" ON "users" ("realm","phone_number");--> statement-breakpoint
CREATE INDEX "verification_created_at_idx" ON "verification" ("created_at");--> statement-breakpoint
CREATE INDEX "verification_target_code_idx" ON "verification" ("target","code");--> statement-breakpoint
ALTER TABLE "identities" ADD CONSTRAINT "identities_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ota_bundles" ADD CONSTRAINT "ota_bundles_app_ref_ota_apps_id_fkey" FOREIGN KEY ("app_ref") REFERENCES "ota_apps"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ota_channels" ADD CONSTRAINT "ota_channels_app_ref_ota_apps_id_fkey" FOREIGN KEY ("app_ref") REFERENCES "ota_apps"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ota_device_overrides" ADD CONSTRAINT "ota_device_overrides_app_ref_ota_apps_id_fkey" FOREIGN KEY ("app_ref") REFERENCES "ota_apps"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ota_devices" ADD CONSTRAINT "ota_devices_app_ref_ota_apps_id_fkey" FOREIGN KEY ("app_ref") REFERENCES "ota_apps"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;