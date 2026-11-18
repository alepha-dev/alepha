CREATE TABLE `project_thresholds` (
	`id` text PRIMARY KEY,
	`project_id` integer NOT NULL,
	`coverage_min` real,
	`coverage_armed` integer,
	`open_errors_max` integer,
	`errors_armed` integer,
	CONSTRAINT `fk_project_thresholds_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_thresholds_project_id_idx` ON `project_thresholds` (`project_id`);