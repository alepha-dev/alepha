CREATE TABLE `dashboard_cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`user_id` text NOT NULL,
	`metric` text NOT NULL,
	`scope` text NOT NULL,
	`filters` text DEFAULT '{}' NOT NULL,
	`size` integer DEFAULT 1 NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	CONSTRAINT `fk_dashboard_cards_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `dashboard_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`user_id` text NOT NULL,
	`seeded_at` text NOT NULL,
	CONSTRAINT `fk_dashboard_settings_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `dashboard_cards_user_id_position_idx` ON `dashboard_cards` (`user_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `dashboard_settings_user_id_idx` ON `dashboard_settings` (`user_id`);