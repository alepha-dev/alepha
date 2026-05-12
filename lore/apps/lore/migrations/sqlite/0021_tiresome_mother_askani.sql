DROP TABLE `whiteboards`;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `icon` text;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `features` text DEFAULT '{"kanban":false,"folios":false,"petitions":false,"chapters":false}' NOT NULL;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `chapter_duration` text;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `kanban_columns` text DEFAULT '["In Progress"]' NOT NULL;--> statement-breakpoint
ALTER TABLE `campaigns` DROP COLUMN `whiteboard`;--> statement-breakpoint
ALTER TABLE `chapters` ADD `closes_at` integer;--> statement-breakpoint
ALTER TABLE `chapters` ADD `tags` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `chapters` ADD `changelog` text;--> statement-breakpoint
ALTER TABLE `quests` ADD `kanban_column` text;