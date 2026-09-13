DROP INDEX IF EXISTS `api_keys_user_id_name_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_user_id_name_live_idx` ON `api_keys` (`user_id`,`name`) WHERE revoked_at IS NULL;