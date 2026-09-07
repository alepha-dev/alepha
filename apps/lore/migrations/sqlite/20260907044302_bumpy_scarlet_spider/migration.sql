CREATE TABLE `notification_inbox` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`user_id` text NOT NULL,
	`scope` text,
	`scope_label` text,
	`template` text NOT NULL,
	`category` text,
	`title` text NOT NULL,
	`body` text,
	`href` text NOT NULL,
	`read_at` integer,
	`organization_id` text
);
--> statement-breakpoint
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
CREATE INDEX `notification_inbox_user_id_read_at_created_at_idx` ON `notification_inbox` (`user_id`,`read_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `notification_inbox_user_id_scope_created_at_idx` ON `notification_inbox` (`user_id`,`scope`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `notification_preferences_user_id_idx` ON `notification_preferences` (`user_id`);