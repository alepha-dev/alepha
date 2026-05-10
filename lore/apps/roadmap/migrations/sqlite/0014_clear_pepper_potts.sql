CREATE TABLE `beacons` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`deleted_at` integer,
	`campaign_id` integer NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`report_type` text NOT NULL,
	`reporter_email` text,
	`status` text NOT NULL,
	`promoted_quest_id` integer,
	`context` text NOT NULL,
	`screenshot_file_id` text,
	`ip_hash` text NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`promoted_quest_id`) REFERENCES `quests`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`screenshot_file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `beacons_campaign_id_status_deleted_at_idx` ON `beacons` (`campaign_id`,`status`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `beacons_campaign_id_created_at_idx` ON `beacons` (`campaign_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `campaigns` ADD `beacons` text;