CREATE TABLE `areas` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`deleted_at` integer,
	`project_id` integer NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`color` text,
	CONSTRAINT `fk_areas_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `areas_project_id_name_idx` ON `areas` (`project_id`,`name`);
--> statement-breakpoint
-- Backfill 1: every area actually in use on a quest, including the ones
-- `projects.areas` never learned about (10 of them in production).
INSERT OR IGNORE INTO `areas` (`project_id`, `name`)
  SELECT DISTINCT `project_id`, `area` FROM `quests`
  WHERE `area` IS NOT NULL AND trim(`area`) <> '' AND `deleted_at` IS NULL;
--> statement-breakpoint
-- Backfill 2: areas declared on the project that hold no quest. Must run
-- AFTER backfill 1 so `INSERT OR IGNORE` dedupes against real usage.
INSERT OR IGNORE INTO `areas` (`project_id`, `name`)
  SELECT p.`id`, j.`value` FROM `projects` p, json_each(p.`areas`) j
  WHERE trim(j.`value`) <> '';