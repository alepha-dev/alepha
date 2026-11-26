ALTER TABLE `monitors` ADD `grace_host` text;--> statement-breakpoint
ALTER TABLE `monitors` ADD `grace_unit` text;--> statement-breakpoint
ALTER TABLE `monitors` ADD `grace_secs` integer DEFAULT 1500 NOT NULL;