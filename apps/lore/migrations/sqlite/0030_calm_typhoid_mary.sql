ALTER TABLE `quests` ADD `reminder_interval` text;--> statement-breakpoint
ALTER TABLE `quests` DROP COLUMN `reminder_interval_ms`;