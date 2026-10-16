ALTER TABLE `monitor_incidents` ADD `open_key` text;--> statement-breakpoint
ALTER TABLE `monitors` ADD `version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `monitors` ADD `last_pushed_at` text;--> statement-breakpoint
ALTER TABLE `monitors` ADD `last_result` text;--> statement-breakpoint
CREATE UNIQUE INDEX `monitor_incidents_open_key_idx` ON `monitor_incidents` (`open_key`);