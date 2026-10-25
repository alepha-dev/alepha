CREATE TABLE `quality_runs` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`project_id` integer NOT NULL,
	`commit_sha` text NOT NULL,
	`branch` text NOT NULL,
	`coverage_lines` real NOT NULL,
	`coverage_statements` real NOT NULL,
	`coverage_functions` real NOT NULL,
	`coverage_branches` real NOT NULL,
	`tests_total` integer NOT NULL,
	`tests_passed` integer NOT NULL,
	`tests_failed` integer NOT NULL,
	`tests_skipped` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`file_id` text,
	CONSTRAINT `fk_quality_runs_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `quality_runs_project_id_created_at_idx` ON `quality_runs` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `quality_runs_project_id_branch_created_at_idx` ON `quality_runs` (`project_id`,`branch`,`created_at`);