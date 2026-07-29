ALTER TABLE `quests` ADD `shelved_at` integer;--> statement-breakpoint
ALTER TABLE `quests` ADD `shelved_by` text REFERENCES users(id);