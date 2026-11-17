CREATE TABLE `requirement_technical_epics` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`project_id` integer NOT NULL,
	`epic_id` integer NOT NULL,
	CONSTRAINT `fk_requirement_technical_epics_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_requirement_technical_epics_epic_id_epics_id_fk` FOREIGN KEY (`epic_id`) REFERENCES `epics`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `requirement_technical_epics_epic_id_idx` ON `requirement_technical_epics` (`epic_id`);