CREATE TABLE `parameters` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
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
CREATE INDEX `parameters_name_activation_date_idx` ON `parameters` (`name`,`activation_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `parameters_name_version_idx` ON `parameters` (`name`,`version`);--> statement-breakpoint
CREATE INDEX `parameters_activation_date_idx` ON `parameters` (`activation_date`);--> statement-breakpoint
DROP TABLE `job_execution_logs`;--> statement-breakpoint
DROP INDEX `job_executions_job_name_status_priority_scheduled_at_idx`;--> statement-breakpoint
DROP INDEX `job_executions_job_name_status_started_at_idx`;--> statement-breakpoint
DROP INDEX `job_executions_job_name_completed_at_idx`;--> statement-breakpoint
ALTER TABLE `job_executions` ADD `logs` text;--> statement-breakpoint
CREATE INDEX `job_executions_job_name_status_scheduled_at_idx` ON `job_executions` (`job_name`,`status`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `job_executions_job_name_started_at_idx` ON `job_executions` (`job_name`,`started_at`);--> statement-breakpoint
ALTER TABLE `job_executions` DROP COLUMN `result`;--> statement-breakpoint
ALTER TABLE `job_executions` DROP COLUMN `worker_id`;