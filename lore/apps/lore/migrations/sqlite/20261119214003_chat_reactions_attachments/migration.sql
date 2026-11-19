CREATE TABLE `chat_reactions` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`message_id` text NOT NULL,
	`room_id` text NOT NULL,
	`user_id` text NOT NULL,
	`emoji` text NOT NULL,
	CONSTRAINT `fk_chat_reactions_message_id_chat_messages_id_fk` FOREIGN KEY (`message_id`) REFERENCES `chat_messages`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_chat_reactions_room_id_chat_rooms_id_fk` FOREIGN KEY (`room_id`) REFERENCES `chat_rooms`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_chat_reactions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `attachments` text;--> statement-breakpoint
CREATE UNIQUE INDEX `chat_reactions_message_id_user_id_emoji_idx` ON `chat_reactions` (`message_id`,`user_id`,`emoji`);--> statement-breakpoint
CREATE INDEX `chat_reactions_user_id_idx` ON `chat_reactions` (`user_id`);