ALTER TABLE `campaigns` ADD COLUMN `chapter_duration` text;--> statement-breakpoint
ALTER TABLE `chapters` ADD COLUMN `closes_at` integer;--> statement-breakpoint
ALTER TABLE `chapters` ADD COLUMN `tags` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `chapters` ADD COLUMN `changelog` text;
