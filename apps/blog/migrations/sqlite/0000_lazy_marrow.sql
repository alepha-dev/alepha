CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
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
CREATE UNIQUE INDEX `api_keys_user_id_name_idx` ON `api_keys` (`user_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_token_hash_idx` ON `api_keys` (`token_hash`);--> statement-breakpoint
CREATE TABLE `audits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
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
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`color` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_slug_idx` ON `categories` (`slug`);--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`post_id` text NOT NULL,
	`author_id` text NOT NULL,
	`content` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`parent_id` text,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `comments_post_id_status_idx` ON `comments` (`post_id`,`status`);--> statement-breakpoint
CREATE INDEX `comments_author_id_idx` ON `comments` (`author_id`);--> statement-breakpoint
CREATE INDEX `comments_status_idx` ON `comments` (`status`);--> statement-breakpoint
CREATE INDEX `comments_parent_id_idx` ON `comments` (`parent_id`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`blob_id` text NOT NULL,
	`creator` text,
	`creator_realm` text,
	`creator_name` text,
	`bucket` text NOT NULL,
	`expiration_date` integer,
	`name` text NOT NULL,
	`size` numeric NOT NULL,
	`mime_type` text NOT NULL,
	`tags` text,
	`checksum` text
);
--> statement-breakpoint
CREATE INDEX `files_expiration_date_idx` ON `files` (`expiration_date`);--> statement-breakpoint
CREATE INDEX `files_bucket_idx` ON `files` (`bucket`);--> statement-breakpoint
CREATE INDEX `files_creator_idx` ON `files` (`creator`);--> statement-breakpoint
CREATE INDEX `files_created_at_idx` ON `files` (`created_at`);--> statement-breakpoint
CREATE INDEX `files_mime_type_idx` ON `files` (`mime_type`);--> statement-breakpoint
CREATE INDEX `files_bucket_created_at_idx` ON `files` (`bucket`,`created_at`);--> statement-breakpoint
CREATE TABLE `identities` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`user_id` text NOT NULL,
	`password` text,
	`provider` text NOT NULL,
	`provider_user_id` text,
	`provider_data` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `job_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`finished_at` integer,
	`job` text NOT NULL,
	`status` text NOT NULL,
	`triggered_by` text,
	`triggered_by_name` text,
	`error` text,
	`logs` text
);
--> statement-breakpoint
CREATE INDEX `job_executions_job_status_idx` ON `job_executions` (`job`,`status`);--> statement-breakpoint
CREATE INDEX `job_executions_job_created_at_idx` ON `job_executions` (`job`,`created_at`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`type` text NOT NULL,
	`template` text NOT NULL,
	`category` text,
	`critical` integer,
	`sensitive` integer,
	`contact` text NOT NULL,
	`variables` text,
	`scheduled_at` integer,
	`sent_at` integer,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `parameters` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`name` text NOT NULL,
	`content` text NOT NULL,
	`schema_hash` text NOT NULL,
	`status` text DEFAULT 'future' NOT NULL,
	`activation_date` integer NOT NULL,
	`expired_at` integer,
	`version` integer NOT NULL,
	`change_description` text,
	`tags` text,
	`creator_id` text,
	`creator_name` text,
	`previous_content` text,
	`migration_log` text
);
--> statement-breakpoint
CREATE INDEX `parameters_name_status_idx` ON `parameters` (`name`,`status`);--> statement-breakpoint
CREATE INDEX `parameters_name_activation_date_idx` ON `parameters` (`name`,`activation_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `parameters_name_version_idx` ON `parameters` (`name`,`version`);--> statement-breakpoint
CREATE INDEX `parameters_status_idx` ON `parameters` (`status`);--> statement-breakpoint
CREATE INDEX `parameters_activation_date_idx` ON `parameters` (`activation_date`);--> statement-breakpoint
CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`content` text NOT NULL,
	`excerpt` text,
	`cover_image_id` text,
	`author_id` text NOT NULL,
	`category_id` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`published_at` integer,
	`tags` text DEFAULT '[]' NOT NULL,
	`featured` integer DEFAULT false NOT NULL,
	`view_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `posts_slug_idx` ON `posts` (`slug`);--> statement-breakpoint
CREATE INDEX `posts_author_id_idx` ON `posts` (`author_id`);--> statement-breakpoint
CREATE INDEX `posts_category_id_idx` ON `posts` (`category_id`);--> statement-breakpoint
CREATE INDEX `posts_status_idx` ON `posts` (`status`);--> statement-breakpoint
CREATE INDEX `posts_status_published_at_idx` ON `posts` (`status`,`published_at`);--> statement-breakpoint
CREATE INDEX `posts_featured_idx` ON `posts` (`featured`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`refresh_token` text NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`ip` text,
	`user_agent` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
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
	`email_verified` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_realm_username_idx` ON `users` (`realm`,`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_realm_email_idx` ON `users` (`realm`,`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_realm_phone_number_idx` ON `users` (`realm`,`phone_number`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`type` text NOT NULL,
	`target` text NOT NULL,
	`code` text NOT NULL,
	`verified_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_created_at_idx` ON `verification` (`created_at`);--> statement-breakpoint
CREATE INDEX `verification_target_code_idx` ON `verification` (`target`,`code`);