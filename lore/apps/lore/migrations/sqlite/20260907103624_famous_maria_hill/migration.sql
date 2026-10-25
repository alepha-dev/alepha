ALTER TABLE `quests` ADD `held_at` integer;--> statement-breakpoint
ALTER TABLE `quests` ADD `held_by` text REFERENCES users(id) ON DELETE SET NULL;