CREATE TABLE `estate_projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`estate_id` text NOT NULL,
	`project_id` integer NOT NULL,
	`created_by` text,
	CONSTRAINT `fk_estate_projects_estate_id_estates_id_fk` FOREIGN KEY (`estate_id`) REFERENCES `estates`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_estate_projects_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_estate_projects_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `estate_projects_estate_id_project_id_idx` ON `estate_projects` (`estate_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `estate_projects_project_id_idx` ON `estate_projects` (`project_id`);