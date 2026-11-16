CREATE TABLE `use_case_run_results` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`run_id` integer NOT NULL,
	`criterion_key` text NOT NULL,
	`result` text NOT NULL,
	`note` text,
	CONSTRAINT `fk_use_case_run_results_run_id_use_case_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `use_case_runs`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `use_case_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`project_id` integer NOT NULL,
	`use_case_id` integer NOT NULL,
	`by` text DEFAULT 'agent' NOT NULL,
	`client` text,
	`by_user_id` text,
	`app` text,
	`env` text,
	`ran_at` integer NOT NULL,
	`scenario_version` integer NOT NULL,
	`note` text,
	`evidence` text DEFAULT '[]' NOT NULL,
	CONSTRAINT `fk_use_case_runs_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_use_case_runs_use_case_id_use_cases_id_fk` FOREIGN KEY (`use_case_id`) REFERENCES `use_cases`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `project_errors` ADD `use_case_run_id` integer;--> statement-breakpoint
ALTER TABLE `project_errors` ADD `criterion_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `use_case_run_results_run_id_criterion_key_idx` ON `use_case_run_results` (`run_id`,`criterion_key`);--> statement-breakpoint
CREATE INDEX `use_case_runs_use_case_id_ran_at_idx` ON `use_case_runs` (`use_case_id`,`ran_at`);--> statement-breakpoint
CREATE INDEX `use_case_runs_project_id_ran_at_idx` ON `use_case_runs` (`project_id`,`ran_at`);