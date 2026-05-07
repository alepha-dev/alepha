PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_folios` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`user_id` text NOT NULL,
	`campaign_id` integer NOT NULL,
	`title` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`search_text` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_folios`("id", "created_at", "updated_at", "user_id", "campaign_id", "title", "content", "tags", "search_text") SELECT "id", "created_at", "updated_at", "user_id", "campaign_id", "title", "content", "tags", "search_text" FROM `folios`;--> statement-breakpoint
DROP TABLE `folios`;--> statement-breakpoint
ALTER TABLE `__new_folios` RENAME TO `folios`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `folios_user_id_updated_at_idx` ON `folios` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `folios_user_id_title_idx` ON `folios` (`user_id`,`title`);--> statement-breakpoint
CREATE INDEX `folios_campaign_id_user_id_updated_at_idx` ON `folios` (`campaign_id`,`user_id`,`updated_at`);