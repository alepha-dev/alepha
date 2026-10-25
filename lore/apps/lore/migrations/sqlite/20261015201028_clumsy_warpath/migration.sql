ALTER TABLE `automations` ADD `health_checked_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `automations_health_checked_at_id_idx` ON `automations` (`health_checked_at`,`id`);