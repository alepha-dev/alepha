PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_folios` (
	`id` text PRIMARY KEY NOT NULL,
	`short_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`campaign_id` integer NOT NULL,
	`title` text NOT NULL,
	`protected` integer DEFAULT false NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`parent_id` text,
	`summary` text DEFAULT '' NOT NULL,
	`search_text` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `folios`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_folios`("id", "short_id", "created_at", "updated_at", "campaign_id", "title", "protected", "content", "tags", "parent_id", "summary", "search_text") SELECT "id", "short_id", "created_at", "updated_at", "campaign_id", "title", "protected", "content", "tags", "parent_id", "summary", "search_text" FROM `folios`;--> statement-breakpoint
DROP TABLE `folios`;--> statement-breakpoint
ALTER TABLE `__new_folios` RENAME TO `folios`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `folios_campaign_id_updated_at_idx` ON `folios` (`campaign_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `folios_campaign_id_title_idx` ON `folios` (`campaign_id`,`title`);--> statement-breakpoint
CREATE UNIQUE INDEX `folios_campaign_id_short_id_idx` ON `folios` (`campaign_id`,`short_id`);