CREATE TABLE `chat_room_members` (
	`id` text PRIMARY KEY,
	`room_id` text NOT NULL,
	`user_id` text NOT NULL,
	`joined_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`last_read_message_id` text,
	`notify_level` text DEFAULT 'mentions' NOT NULL,
	CONSTRAINT `fk_chat_room_members_room_id_chat_rooms_id_fk` FOREIGN KEY (`room_id`) REFERENCES `chat_rooms`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_chat_room_members_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `chat_rooms` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`project_id` integer NOT NULL,
	`name` text NOT NULL,
	`private` integer DEFAULT false NOT NULL,
	`archived_at` integer,
	`created_by` text,
	CONSTRAINT `fk_chat_rooms_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_chat_rooms_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_room_members_room_id_user_id_idx` ON `chat_room_members` (`room_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `chat_room_members_user_id_idx` ON `chat_room_members` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `chat_rooms_project_id_name_idx` ON `chat_rooms` (`project_id`,`name`);