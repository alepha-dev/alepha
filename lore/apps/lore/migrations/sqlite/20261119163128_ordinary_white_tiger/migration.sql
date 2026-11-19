CREATE TABLE `code_repositories` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`project_id` integer NOT NULL,
	`slug` text NOT NULL,
	`default_branch` text DEFAULT 'main' NOT NULL,
	`backend_ref` text NOT NULL,
	`created_by` text,
	`archived_at` integer,
	CONSTRAINT `fk_code_repositories_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_code_repositories_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `code_repositories_project_id_slug_idx` ON `code_repositories` (`project_id`,`slug`);