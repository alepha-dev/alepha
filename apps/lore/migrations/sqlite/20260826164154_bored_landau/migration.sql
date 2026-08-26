ALTER TABLE `sigil_uniques_daily` ADD `traffic` text DEFAULT 'human' NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS `sigil_uniques_daily_sigil_id_day_visitor_hash_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `sigil_uniques_daily_sigil_id_day_visitor_hash_traffic_idx` ON `sigil_uniques_daily` (`sigil_id`,`day`,`visitor_hash`,`traffic`);