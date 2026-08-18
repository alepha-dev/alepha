CREATE TABLE `alepha_sequences` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`name` text NOT NULL,
	`scope` text DEFAULT 'default' NOT NULL,
	`value` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`organization_id` text,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`token_hash` text NOT NULL,
	`token_prefix` text NOT NULL,
	`token_suffix` text NOT NULL,
	`roles` text DEFAULT '[]' NOT NULL,
	`last_used_at` integer,
	`last_used_ip` text,
	`usage_count` integer DEFAULT 0 NOT NULL,
	`expires_at` integer,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE TABLE `audits` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`organization_id` text,
	`type` text NOT NULL,
	`action` text NOT NULL,
	`severity` text DEFAULT 'info' NOT NULL,
	`user_id` text,
	`user_realm` text,
	`user_email` text,
	`resource_type` text,
	`resource_id` text,
	`description` text,
	`metadata` text,
	`ip_address` text,
	`user_agent` text,
	`session_id` text,
	`request_id` text,
	`success` integer DEFAULT true NOT NULL,
	`error_message` text
);
--> statement-breakpoint
CREATE TABLE `cache_entries` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`container` text NOT NULL,
	`cache_key` text NOT NULL,
	`value` text,
	`count` integer,
	`expires_at` integer
);
--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`organization_id` text,
	`blob_id` text NOT NULL,
	`creator` text,
	`creator_realm` text,
	`creator_name` text,
	`bucket` text NOT NULL,
	`expiration_date` integer,
	`name` text NOT NULL,
	`original_name` text,
	`size` real NOT NULL,
	`mime_type` text NOT NULL,
	`tags` text,
	`checksum` text
);
--> statement-breakpoint
CREATE TABLE `identities` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`user_id` text NOT NULL,
	`password` text,
	`provider` text NOT NULL,
	`provider_user_id` text,
	`provider_data` text,
	CONSTRAINT `fk_identities_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `job_executions` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`job_name` text NOT NULL,
	`key` text,
	`organization_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`priority` integer DEFAULT 2 NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 1 NOT NULL,
	`payload` text,
	`scheduled_at` integer,
	`started_at` integer,
	`completed_at` integer,
	`error` text,
	`logs` text,
	`triggered_by` text,
	`triggered_by_name` text,
	`cancelled_by` text,
	`cancelled_by_name` text
);
--> statement-breakpoint
CREATE TABLE `parameters` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`organization_id` text,
	`name` text NOT NULL,
	`content` text NOT NULL,
	`schema_hash` text NOT NULL,
	`activation_date` integer NOT NULL,
	`version` integer NOT NULL,
	`change_description` text,
	`tags` text,
	`creator_id` text,
	`creator_name` text,
	`previous_content` text,
	`migration_log` text
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`refresh_token` text NOT NULL,
	`user_id` text NOT NULL,
	`client_id` text,
	`expires_at` integer NOT NULL,
	`last_used_at` integer,
	`ip` text,
	`country` text,
	`user_agent` text,
	CONSTRAINT `fk_sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`realm` text DEFAULT 'default' NOT NULL,
	`username` text,
	`email` text,
	`phone_number` text,
	`roles` text DEFAULT '[]' NOT NULL,
	`first_name` text,
	`last_name` text,
	`picture` text,
	`enabled` integer DEFAULT true NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`last_login_at` integer,
	`organization_id` text
);
--> statement-breakpoint
CREATE TABLE `verification` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`type` text NOT NULL,
	`target` text NOT NULL,
	`purpose` text DEFAULT 'default' NOT NULL,
	`code` text NOT NULL,
	`verified_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `alepha_sequences_name_scope_idx` ON `alepha_sequences` (`name`,`scope`);--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_user_id_name_idx` ON `api_keys` (`user_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_token_hash_idx` ON `api_keys` (`token_hash`);--> statement-breakpoint
CREATE INDEX `audits_created_at_idx` ON `audits` (`created_at`);--> statement-breakpoint
CREATE INDEX `audits_type_idx` ON `audits` (`type`);--> statement-breakpoint
CREATE INDEX `audits_action_idx` ON `audits` (`action`);--> statement-breakpoint
CREATE INDEX `audits_user_id_idx` ON `audits` (`user_id`);--> statement-breakpoint
CREATE INDEX `audits_user_realm_idx` ON `audits` (`user_realm`);--> statement-breakpoint
CREATE INDEX `audits_resource_type_idx` ON `audits` (`resource_type`);--> statement-breakpoint
CREATE INDEX `audits_resource_id_idx` ON `audits` (`resource_id`);--> statement-breakpoint
CREATE INDEX `audits_severity_idx` ON `audits` (`severity`);--> statement-breakpoint
CREATE INDEX `audits_type_action_idx` ON `audits` (`type`,`action`);--> statement-breakpoint
CREATE INDEX `audits_user_id_created_at_idx` ON `audits` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audits_user_realm_created_at_idx` ON `audits` (`user_realm`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `cache_entries_container_cache_key_idx` ON `cache_entries` (`container`,`cache_key`);--> statement-breakpoint
CREATE INDEX `cache_entries_expires_at_idx` ON `cache_entries` (`expires_at`);--> statement-breakpoint
CREATE INDEX `files_expiration_date_idx` ON `files` (`expiration_date`);--> statement-breakpoint
CREATE INDEX `files_bucket_idx` ON `files` (`bucket`);--> statement-breakpoint
CREATE INDEX `files_creator_idx` ON `files` (`creator`);--> statement-breakpoint
CREATE INDEX `files_created_at_idx` ON `files` (`created_at`);--> statement-breakpoint
CREATE INDEX `files_mime_type_idx` ON `files` (`mime_type`);--> statement-breakpoint
CREATE INDEX `files_bucket_created_at_idx` ON `files` (`bucket`,`created_at`);--> statement-breakpoint
CREATE INDEX `identities_user_id_idx` ON `identities` (`user_id`);--> statement-breakpoint
CREATE INDEX `identities_provider_idx` ON `identities` (`provider`);--> statement-breakpoint
CREATE INDEX `identities_user_id_provider_idx` ON `identities` (`user_id`,`provider`);--> statement-breakpoint
CREATE UNIQUE INDEX `identities_provider_provider_user_id_idx` ON `identities` (`provider`,`provider_user_id`);--> statement-breakpoint
CREATE INDEX `job_executions_job_name_status_scheduled_at_idx` ON `job_executions` (`job_name`,`status`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `job_executions_job_name_status_created_at_idx` ON `job_executions` (`job_name`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `job_executions_job_name_started_at_idx` ON `job_executions` (`job_name`,`started_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `job_executions_job_name_key_idx` ON `job_executions` (`job_name`,`key`);--> statement-breakpoint
CREATE INDEX `parameters_organization_id_name_activation_date_idx` ON `parameters` (`organization_id`,`name`,`activation_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `parameters_organization_id_name_version_idx` ON `parameters` (`organization_id`,`name`,`version`);--> statement-breakpoint
CREATE INDEX `parameters_activation_date_idx` ON `parameters` (`activation_date`);--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_at_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_refresh_token_idx` ON `sessions` (`refresh_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_realm_username_lower_idx` ON `users` (`realm`,LOWER("username"));--> statement-breakpoint
CREATE UNIQUE INDEX `users_realm_email_idx` ON `users` (`realm`,`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_realm_phone_number_idx` ON `users` (`realm`,`phone_number`);--> statement-breakpoint
CREATE INDEX `verification_created_at_idx` ON `verification` (`created_at`);--> statement-breakpoint
CREATE INDEX `verification_target_code_idx` ON `verification` (`target`,`code`);