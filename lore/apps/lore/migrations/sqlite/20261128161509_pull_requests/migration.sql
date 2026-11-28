CREATE TABLE `pull_requests` (
	`id` text PRIMARY KEY,
	`project_id` integer NOT NULL,
	`repository_id` integer NOT NULL,
	`repository` text NOT NULL,
	`github_id` integer NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`author_login` text,
	`author_github_id` integer,
	`author_permission` text,
	`trusted_by` text,
	`trusted_at` text,
	`head_ref` text NOT NULL,
	`base_ref` text NOT NULL,
	`head_sha` text NOT NULL,
	`state` text NOT NULL,
	`queued` integer,
	`checks` text NOT NULL,
	`review` text NOT NULL,
	`mergeable_state` text,
	`suites` text,
	`statuses` text,
	`failing_checks` text,
	`merged_at` text,
	`closed_at` text,
	`github_updated_at` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	CONSTRAINT `fk_pull_requests_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_pull_requests_trusted_by_users_id_fk` FOREIGN KEY (`trusted_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pull_requests_repository_id_number_idx` ON `pull_requests` (`repository_id`,`number`);--> statement-breakpoint
CREATE INDEX `pull_requests_project_id_state_idx` ON `pull_requests` (`project_id`,`state`);--> statement-breakpoint
CREATE INDEX `pull_requests_project_id_head_ref_idx` ON `pull_requests` (`project_id`,`head_ref`);