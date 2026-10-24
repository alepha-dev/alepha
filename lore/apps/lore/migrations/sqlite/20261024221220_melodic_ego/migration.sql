CREATE TABLE `stack_deployments` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`project_id` integer NOT NULL,
	`environment_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`revision` integer NOT NULL,
	`sha256` text NOT NULL,
	`estate_id` text NOT NULL,
	`command_id` text NOT NULL,
	`status` text NOT NULL,
	`step` text,
	`error` text,
	`plan` text,
	`services` text,
	`warnings` text,
	`finished_at` integer,
	`created_by` text,
	CONSTRAINT `fk_stack_deployments_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_stack_deployments_environment_id_stack_environments_id_fk` FOREIGN KEY (`environment_id`) REFERENCES `stack_environments`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `stack_deployments_environment_id_created_at_idx` ON `stack_deployments` (`environment_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `stack_deployments_command_id_idx` ON `stack_deployments` (`command_id`);--> statement-breakpoint
CREATE INDEX `stack_deployments_project_id_idx` ON `stack_deployments` (`project_id`);