CREATE TABLE `requirements_coverage_days` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`project_id` integer NOT NULL,
	`day` text NOT NULL,
	`scope` text NOT NULL,
	`verified` integer NOT NULL,
	`covered` integer NOT NULL,
	`total` integer NOT NULL,
	CONSTRAINT `fk_requirements_coverage_days_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `requirements_coverage_days_project_id_scope_day_idx` ON `requirements_coverage_days` (`project_id`,`scope`,`day`);