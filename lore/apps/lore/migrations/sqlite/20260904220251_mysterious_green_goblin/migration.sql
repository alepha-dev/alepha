CREATE TABLE `estates` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`owner_user_id` text NOT NULL,
	`type` text NOT NULL,
	`slug` text NOT NULL,
	`label` text,
	`secret_hash` text,
	`secret_prefix` text,
	`collect_series` integer DEFAULT false NOT NULL,
	`deploy_allowed` integer DEFAULT false NOT NULL,
	`stats_interval_seconds` integer DEFAULT 1800 NOT NULL,
	`connected_at` text,
	`disconnected_at` text,
	`last_seen_at` text,
	`cpu_percent` real,
	`memory_percent` real,
	`stats_at` text,
	CONSTRAINT `fk_estates_owner_user_id_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `estates_owner_user_id_slug_idx` ON `estates` (`owner_user_id`,`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `estates_secret_hash_idx` ON `estates` (`secret_hash`);