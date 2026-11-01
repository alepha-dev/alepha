CREATE TABLE `quest_flow_daily` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`project_id` integer NOT NULL,
	`day` text NOT NULL,
	`dimension` text NOT NULL,
	`subject` text NOT NULL,
	`todo` integer NOT NULL,
	`in_progress` integer NOT NULL,
	`on_hold` integer NOT NULL,
	`done` integer NOT NULL,
	CONSTRAINT `fk_quest_flow_daily_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quest_flow_daily_project_id_dimension_subject_day_idx` ON `quest_flow_daily` (`project_id`,`dimension`,`subject`,`day`);--> statement-breakpoint
CREATE INDEX `quest_flow_daily_project_id_day_idx` ON `quest_flow_daily` (`project_id`,`day`);