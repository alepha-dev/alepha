CREATE TABLE `chat_mentions` (
	`id` text PRIMARY KEY,
	`message_id` text NOT NULL,
	`room_id` text NOT NULL,
	`user_id` text,
	`agent` text,
	CONSTRAINT `fk_chat_mentions_message_id_chat_messages_id_fk` FOREIGN KEY (`message_id`) REFERENCES `chat_messages`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_chat_mentions_room_id_chat_rooms_id_fk` FOREIGN KEY (`room_id`) REFERENCES `chat_rooms`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_chat_mentions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`room_id` text NOT NULL,
	`author_id` text,
	`agent` text,
	`body` text NOT NULL,
	`references` text DEFAULT '[]' NOT NULL,
	`edited_at` integer,
	`deleted_at` integer,
	`ai_message_id` text,
	CONSTRAINT `fk_chat_messages_room_id_chat_rooms_id_fk` FOREIGN KEY (`room_id`) REFERENCES `chat_rooms`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_chat_messages_author_id_users_id_fk` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `chat_mentions_user_id_room_id_message_id_idx` ON `chat_mentions` (`user_id`,`room_id`,`message_id`);--> statement-breakpoint
CREATE INDEX `chat_mentions_message_id_idx` ON `chat_mentions` (`message_id`);--> statement-breakpoint
CREATE INDEX `chat_messages_room_id_id_idx` ON `chat_messages` (`room_id`,`id`);--> statement-breakpoint
CREATE INDEX `chat_messages_author_id_idx` ON `chat_messages` (`author_id`);