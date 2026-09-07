CREATE TABLE `notification_preferences` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`user_id` text NOT NULL,
	`email_enabled` integer DEFAULT true NOT NULL,
	`muted_categories` text DEFAULT '[]' NOT NULL,
	CONSTRAINT `fk_notification_preferences_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_preferences_user_id_idx` ON `notification_preferences` (`user_id`);