ALTER TABLE `petitions` ADD `tags` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `petitions` DROP COLUMN `report_type`;--> statement-breakpoint
ALTER TABLE `petitions` DROP COLUMN `context`;