ALTER TABLE `api_keys` ADD `permissions` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `api_keys` ADD `rotated_at` integer;--> statement-breakpoint
ALTER TABLE `api_keys` ADD `expiry_notice_sent_at` integer;--> statement-breakpoint
ALTER TABLE `sessions` ADD `scopes` text;--> statement-breakpoint
DROP INDEX IF EXISTS `api_keys_user_id_name_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_user_id_name_live_idx` ON `api_keys` (`user_id`,`name`) WHERE revoked_at IS NULL;