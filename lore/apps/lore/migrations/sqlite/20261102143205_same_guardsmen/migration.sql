CREATE TABLE `estate_events` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`estate_id` text NOT NULL,
	`event_id` text NOT NULL,
	`kind` text NOT NULL,
	`app` text,
	`env` text,
	`at` text NOT NULL,
	`data` text,
	CONSTRAINT `fk_estate_events_estate_id_estates_id_fk` FOREIGN KEY (`estate_id`) REFERENCES `estates`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `estate_events_estate_id_event_id_idx` ON `estate_events` (`estate_id`,`event_id`);--> statement-breakpoint
CREATE INDEX `estate_events_estate_id_app_env_at_idx` ON `estate_events` (`estate_id`,`app`,`env`,`at`);