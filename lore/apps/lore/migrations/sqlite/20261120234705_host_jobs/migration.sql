CREATE TABLE `host_job_logs` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`job_id` text NOT NULL,
	`stream` text NOT NULL,
	`offset` integer NOT NULL,
	`data` text NOT NULL,
	CONSTRAINT `fk_host_job_logs_job_id_host_jobs_id_fk` FOREIGN KEY (`job_id`) REFERENCES `host_jobs`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `host_jobs` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`project_id` integer NOT NULL,
	`host_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`input` text NOT NULL,
	`started_by` text,
	`started_by_job_id` text,
	`subject_type` text,
	`subject_id` text,
	`command_id` text,
	`queued_at` text NOT NULL,
	`started_at` text,
	`ended_at` text,
	`reason` text,
	`exit_code` integer,
	`log_file_id` text,
	`log_bytes` integer,
	`log_truncated` integer,
	`result` text,
	`retries` integer,
	`retry_at` text,
	CONSTRAINT `fk_host_jobs_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_host_jobs_host_id_hosts_id_fk` FOREIGN KEY (`host_id`) REFERENCES `hosts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_host_jobs_started_by_users_id_fk` FOREIGN KEY (`started_by`) REFERENCES `users`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_host_jobs_command_id_host_commands_id_fk` FOREIGN KEY (`command_id`) REFERENCES `host_commands`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
ALTER TABLE `hosts` ADD `jobs_allowed` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `host_job_logs_job_id_stream_offset_idx` ON `host_job_logs` (`job_id`,`stream`,`offset`);--> statement-breakpoint
CREATE INDEX `host_jobs_host_id_status_queued_at_idx` ON `host_jobs` (`host_id`,`status`,`queued_at`);--> statement-breakpoint
CREATE INDEX `host_jobs_project_id_queued_at_idx` ON `host_jobs` (`project_id`,`queued_at`);--> statement-breakpoint
CREATE INDEX `host_jobs_command_id_idx` ON `host_jobs` (`command_id`);