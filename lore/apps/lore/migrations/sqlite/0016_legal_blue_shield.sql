ALTER TABLE `campaigns` ADD `unlocked_features` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `unlock_history` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `characters` ADD `alias` text;--> statement-breakpoint
ALTER TABLE `characters` ADD `picture` text;--> statement-breakpoint
ALTER TABLE `characters` ADD `equipped_title` text;--> statement-breakpoint
ALTER TABLE `characters` ADD `achievements` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `quests` ADD `recommended_level` integer;--> statement-breakpoint
ALTER TABLE `quests` ADD `required_level` integer;