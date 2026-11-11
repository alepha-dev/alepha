CREATE TABLE `user_docks` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`user_id` text NOT NULL,
	`project_ids` text DEFAULT '[]' NOT NULL,
	`seeded_at` integer NOT NULL,
	CONSTRAINT `fk_user_docks_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_docks_user_id_idx` ON `user_docks` (`user_id`);