CREATE TABLE `feedback_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`feedback_id` integer NOT NULL,
	`author_id` text,
	`body` text NOT NULL,
	`edited_at` integer,
	`source` text,
	CONSTRAINT `fk_feedback_comments_feedback_id_feedback_id_fk` FOREIGN KEY (`feedback_id`) REFERENCES `feedback`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_feedback_comments_author_id_users_id_fk` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `feedback_comments_feedback_id_created_at_idx` ON `feedback_comments` (`feedback_id`,`created_at`);