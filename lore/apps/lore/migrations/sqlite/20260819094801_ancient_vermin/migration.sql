CREATE TABLE `epics` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`deleted_at` integer,
	`project_id` integer NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`activated_at` integer,
	`completed_at` integer,
	CONSTRAINT `fk_epics_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `folios` ADD `epic_id` integer REFERENCES epics(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `quests` ADD `epic_id` integer REFERENCES epics(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `epics_project_id_number_idx` ON `epics` (`project_id`,`number`);--> statement-breakpoint
CREATE INDEX `epics_project_id_status_idx` ON `epics` (`project_id`,`status`);