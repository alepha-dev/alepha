CREATE TABLE `project_dashboard_cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`project_id` integer NOT NULL,
	`metric` text NOT NULL,
	`scope` text NOT NULL,
	`filters` text DEFAULT '{}' NOT NULL,
	`size` integer DEFAULT 1 NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	CONSTRAINT `fk_project_dashboard_cards_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `project_dashboard_cards_project_id_position_idx` ON `project_dashboard_cards` (`project_id`,`position`);