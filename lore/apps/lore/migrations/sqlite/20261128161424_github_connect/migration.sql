CREATE TABLE `project_repositories` (
	`id` text PRIMARY KEY,
	`project_id` integer NOT NULL,
	`installation_id` integer NOT NULL,
	`repository_id` integer NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`default_branch` text NOT NULL,
	`former_names` text,
	`connected_by` text,
	`connected_by_github_id` integer,
	`connected_at` text NOT NULL,
	`disconnected_at` text,
	`disconnect_reason` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	CONSTRAINT `fk_project_repositories_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_project_repositories_connected_by_users_id_fk` FOREIGN KEY (`connected_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
ALTER TABLE `github_states` ADD `installation_id` integer;--> statement-breakpoint
ALTER TABLE `github_states` ADD `repository_ids` text;--> statement-breakpoint
ALTER TABLE `github_states` ADD `github_user_id` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `project_repositories_project_id_idx` ON `project_repositories` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_repositories_repository_id_idx` ON `project_repositories` (`repository_id`);--> statement-breakpoint
CREATE INDEX `project_repositories_installation_id_idx` ON `project_repositories` (`installation_id`);