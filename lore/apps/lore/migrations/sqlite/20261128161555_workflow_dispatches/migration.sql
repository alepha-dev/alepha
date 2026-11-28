CREATE TABLE `workflow_dispatches` (
	`id` text PRIMARY KEY,
	`project_id` integer NOT NULL,
	`workflow_id` integer NOT NULL,
	`workflow_name` text NOT NULL,
	`ref` text NOT NULL,
	`inputs` text,
	`requested_by` text,
	`requested_at` text NOT NULL,
	`run_id` integer,
	`run_url` text,
	`run_status` text,
	`run_conclusion` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	CONSTRAINT `fk_workflow_dispatches_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_workflow_dispatches_requested_by_users_id_fk` FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `workflow_dispatches_project_id_requested_at_idx` ON `workflow_dispatches` (`project_id`,`requested_at`);--> statement-breakpoint
CREATE INDEX `workflow_dispatches_project_id_run_id_idx` ON `workflow_dispatches` (`project_id`,`run_id`);