ALTER TABLE `feedback` ADD `trusted_at` integer;--> statement-breakpoint
ALTER TABLE `feedback` ADD `trusted_by` text REFERENCES users(id) ON DELETE SET NULL;