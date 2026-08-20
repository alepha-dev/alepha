CREATE TABLE `quest_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`quest_id` integer NOT NULL,
	`author_id` text,
	`body` text NOT NULL,
	`edited_at` integer,
	CONSTRAINT `fk_quest_comments_quest_id_quests_id_fk` FOREIGN KEY (`quest_id`) REFERENCES `quests`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_quest_comments_author_id_users_id_fk` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
