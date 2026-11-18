CREATE TABLE `project_events` (
	`id` text PRIMARY KEY,
	`project_id` integer NOT NULL,
	`name` text NOT NULL,
	`subject_kind` text NOT NULL,
	`subject_id` text,
	`fields` text NOT NULL,
	`occurred_at` integer NOT NULL,
	CONSTRAINT `fk_project_events_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `project_events_project_id_occurred_at_idx` ON `project_events` (`project_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `project_events_occurred_at_idx` ON `project_events` (`occurred_at`);