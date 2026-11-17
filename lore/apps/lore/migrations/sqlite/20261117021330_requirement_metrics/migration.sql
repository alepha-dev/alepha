CREATE TABLE `requirement_metric_days` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`project_id` integer NOT NULL,
	`requirement_id` integer NOT NULL,
	`day` text NOT NULL,
	`value` real,
	`status` text NOT NULL,
	CONSTRAINT `fk_requirement_metric_days_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_requirement_metric_days_requirement_id_requirements_id_fk` FOREIGN KEY (`requirement_id`) REFERENCES `requirements`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `requirements` ADD `metric` text;--> statement-breakpoint
ALTER TABLE `requirements` ADD `metric_value` real;--> statement-breakpoint
ALTER TABLE `requirements` ADD `metric_status` text;--> statement-breakpoint
ALTER TABLE `requirements` ADD `metric_status_since` integer;--> statement-breakpoint
ALTER TABLE `requirements` ADD `metric_evaluated_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `requirement_metric_days_requirement_id_day_idx` ON `requirement_metric_days` (`requirement_id`,`day`);