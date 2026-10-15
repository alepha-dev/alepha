CREATE TABLE `automation_runs` (
	`id` text PRIMARY KEY,
	`project_id` integer NOT NULL,
	`automation_id` text NOT NULL,
	`rule_revision` integer NOT NULL,
	`occurrence_id` text NOT NULL,
	`triggered_at` integer NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	`snapshot` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`finished_at` integer,
	CONSTRAINT `fk_automation_runs_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_automation_runs_automation_id_automations_id_fk` FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `automation_variables` (
	`id` text PRIMARY KEY,
	`project_id` integer NOT NULL,
	`key` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`value` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	CONSTRAINT `fk_automation_variables_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `automations` (
	`id` text PRIMARY KEY,
	`project_id` integer NOT NULL,
	`author_user_id` text NOT NULL,
	`author_key_id` text,
	`title` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`health` text DEFAULT 'active' NOT NULL,
	`reason` text,
	`requires_approval` integer DEFAULT false NOT NULL,
	`rule` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`preset_key` text,
	`next_run_at` integer,
	`baseline` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`deleted_at` integer,
	CONSTRAINT `fk_automations_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_automations_author_user_id_users_id_fk` FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX `automation_runs_automation_id_created_at_id_idx` ON `automation_runs` (`automation_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `automation_runs_project_id_created_at_id_idx` ON `automation_runs` (`project_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `automation_runs_finished_at_id_idx` ON `automation_runs` (`finished_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `automation_variables_project_id_key_idx` ON `automation_variables` (`project_id`,`key`);--> statement-breakpoint
CREATE INDEX `automations_enabled_health_next_run_at_id_idx` ON `automations` (`enabled`,`health`,`next_run_at`,`id`);--> statement-breakpoint
CREATE INDEX `automations_project_id_author_user_id_idx` ON `automations` (`project_id`,`author_user_id`);--> statement-breakpoint
CREATE INDEX `automations_author_user_id_idx` ON `automations` (`author_user_id`);