CREATE TABLE `cache_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`container` text NOT NULL,
	`cache_key` text NOT NULL,
	`value` text,
	`count` integer,
	`expires_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cache_entries_container_cache_key_idx` ON `cache_entries` (`container`,`cache_key`);--> statement-breakpoint
CREATE INDEX `cache_entries_expires_at_idx` ON `cache_entries` (`expires_at`);