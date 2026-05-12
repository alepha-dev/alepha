-- Hard-rename of beacons → petitions with a reshape (drop old IP/embed/screenshot
-- columns, add reporter_user_id + attachments + slim context). The original
-- beacons table was empty in any deployment, so we drop+create rather than
-- INSERT SELECT — that avoids referencing columns that never existed in the
-- old shape (the schema generator assumed the new shape was already in place).
DROP TABLE IF EXISTS `beacons`;--> statement-breakpoint
DROP TABLE IF EXISTS `petitions`;--> statement-breakpoint
CREATE TABLE `petitions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`deleted_at` integer,
	`campaign_id` integer NOT NULL,
	`reporter_user_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`report_type` text NOT NULL,
	`status` text NOT NULL,
	`promoted_quest_id` integer,
	`attachments` text DEFAULT '[]' NOT NULL,
	`context` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reporter_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`promoted_quest_id`) REFERENCES `quests`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `petitions_campaign_id_status_deleted_at_idx` ON `petitions` (`campaign_id`,`status`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `petitions_campaign_id_created_at_idx` ON `petitions` (`campaign_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `petitions_reporter_user_id_created_at_idx` ON `petitions` (`reporter_user_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `campaigns` DROP COLUMN `beacons`;
