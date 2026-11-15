CREATE TABLE `project_exclusions` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`project_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`excluded_by` text NOT NULL,
	CONSTRAINT `fk_project_exclusions_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_exclusions_project_id_user_id_idx` ON `project_exclusions` (`project_id`,`user_id`);