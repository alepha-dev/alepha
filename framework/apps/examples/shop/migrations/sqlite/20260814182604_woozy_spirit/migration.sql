CREATE TABLE `workflow_executions` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`workflow_name` text NOT NULL,
	`tags` text,
	`payload` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`current_step` text,
	`started_at` integer,
	`completed_at` integer,
	`deadline_at` integer,
	`scheduled_at` integer,
	`error` text,
	`error_step` text,
	`triggered_by` text,
	`triggered_by_name` text,
	`cancelled_by` text,
	`cancelled_by_name` text,
	`key` text,
	`priority` integer DEFAULT 2 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workflow_step_executions` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`workflow_execution_id` text NOT NULL,
	`step_name` text NOT NULL,
	`step_index` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 1 NOT NULL,
	`result` text,
	`error` text,
	`started_at` integer,
	`completed_at` integer,
	`scheduled_at` integer,
	CONSTRAINT `fk_workflow_step_executions_workflow_execution_id_workflow_executions_id_fk` FOREIGN KEY (`workflow_execution_id`) REFERENCES `workflow_executions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `workflow_step_logs` (
	`id` text PRIMARY KEY,
	`logs` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workflow_executions_workflow_name_status_idx` ON `workflow_executions` (`workflow_name`,`status`);--> statement-breakpoint
CREATE INDEX `workflow_executions_workflow_name_status_created_at_idx` ON `workflow_executions` (`workflow_name`,`status`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_executions_workflow_name_key_idx` ON `workflow_executions` (`workflow_name`,`key`) WHERE status NOT IN ('completed', 'failed', 'timed_out', 'compensated', 'compensation_failed', 'cancelled');--> statement-breakpoint
CREATE INDEX `workflow_executions_status_deadline_at_idx` ON `workflow_executions` (`status`,`deadline_at`);--> statement-breakpoint
CREATE INDEX `workflow_executions_completed_at_idx` ON `workflow_executions` (`completed_at`);--> statement-breakpoint
CREATE INDEX `workflow_step_executions_workflow_execution_id_step_name_idx` ON `workflow_step_executions` (`workflow_execution_id`,`step_name`);--> statement-breakpoint
CREATE INDEX `workflow_step_executions_workflow_execution_id_step_index_idx` ON `workflow_step_executions` (`workflow_execution_id`,`step_index`);--> statement-breakpoint
CREATE INDEX `workflow_step_executions_workflow_execution_id_status_idx` ON `workflow_step_executions` (`workflow_execution_id`,`status`);--> statement-breakpoint
CREATE INDEX `workflow_step_executions_status_scheduled_at_idx` ON `workflow_step_executions` (`status`,`scheduled_at`);