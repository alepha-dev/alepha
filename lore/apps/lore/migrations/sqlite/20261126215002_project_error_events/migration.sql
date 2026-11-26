CREATE TABLE `project_error_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`project_error_id` integer NOT NULL,
	`kind` text NOT NULL,
	`actor_id` text,
	`quest_id` integer,
	CONSTRAINT `fk_project_error_events_project_error_id_project_errors_id_fk` FOREIGN KEY (`project_error_id`) REFERENCES `project_errors`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_project_error_events_actor_id_users_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `project_error_events_project_error_id_created_at_idx` ON `project_error_events` (`project_error_id`,`created_at`);