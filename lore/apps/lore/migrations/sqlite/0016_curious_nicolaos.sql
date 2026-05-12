PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_petitions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`deleted_at` integer,
	`campaign_id` integer NOT NULL,
	`reporter_user_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`report_type` text NOT NULL,
	`status` text NOT NULL,
	`attachments` text DEFAULT '[]' NOT NULL,
	`context` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reporter_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_petitions`("id", "created_at", "deleted_at", "campaign_id", "reporter_user_id", "title", "description", "report_type", "status", "attachments", "context") SELECT "id", "created_at", "deleted_at", "campaign_id", "reporter_user_id", "title", "description", "report_type", "status", "attachments", "context" FROM `petitions`;--> statement-breakpoint
DROP TABLE `petitions`;--> statement-breakpoint
ALTER TABLE `__new_petitions` RENAME TO `petitions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `petitions_campaign_id_status_deleted_at_idx` ON `petitions` (`campaign_id`,`status`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `petitions_campaign_id_created_at_idx` ON `petitions` (`campaign_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `petitions_reporter_user_id_created_at_idx` ON `petitions` (`reporter_user_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `quests` ADD `petition_id` integer REFERENCES petitions(id);