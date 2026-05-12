PRAGMA foreign_keys=OFF;--> statement-breakpoint
DROP TABLE IF EXISTS `whiteboards`;--> statement-breakpoint
CREATE TABLE `__new_campaigns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`deleted_at` integer,
	`title` text NOT NULL,
	`created_by` text NOT NULL,
	`public` integer,
	`zones` text DEFAULT '[]' NOT NULL,
	`features` text DEFAULT '{"kanban":false,"folios":false,"petitions":false,"chapters":false}' NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_campaigns`("id", "created_at", "updated_at", "deleted_at", "title", "created_by", "public", "zones") SELECT "id", "created_at", "updated_at", "deleted_at", "title", "created_by", "public", "zones" FROM `campaigns`;--> statement-breakpoint
DROP TABLE `campaigns`;--> statement-breakpoint
ALTER TABLE `__new_campaigns` RENAME TO `campaigns`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `campaigns_created_by_idx` ON `campaigns` (`created_by`);
