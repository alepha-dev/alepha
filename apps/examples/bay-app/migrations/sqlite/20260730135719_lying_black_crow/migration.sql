CREATE TABLE `alepha_sequences` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`name` text NOT NULL,
	`scope` text DEFAULT 'default' NOT NULL,
	`value` integer NOT NULL
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
CREATE TABLE `visits` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`name` text NOT NULL,
	`count` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `alepha_sequences_name_scope_idx` ON `alepha_sequences` (`name`,`scope`);--> statement-breakpoint
CREATE INDEX `files_expiration_date_idx` ON `files` (`expiration_date`);--> statement-breakpoint
CREATE INDEX `files_bucket_idx` ON `files` (`bucket`);--> statement-breakpoint
CREATE INDEX `files_creator_idx` ON `files` (`creator`);--> statement-breakpoint
CREATE INDEX `files_created_at_idx` ON `files` (`created_at`);--> statement-breakpoint
CREATE INDEX `files_mime_type_idx` ON `files` (`mime_type`);--> statement-breakpoint
CREATE INDEX `files_bucket_created_at_idx` ON `files` (`bucket`,`created_at`);--> statement-breakpoint
CREATE INDEX `job_executions_job_name_status_scheduled_at_idx` ON `job_executions` (`job_name`,`status`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `job_executions_job_name_status_created_at_idx` ON `job_executions` (`job_name`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `job_executions_job_name_started_at_idx` ON `job_executions` (`job_name`,`started_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `job_executions_job_name_key_idx` ON `job_executions` (`job_name`,`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `visits_name_idx` ON `visits` (`name`);