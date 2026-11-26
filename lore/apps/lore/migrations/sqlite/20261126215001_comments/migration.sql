CREATE TABLE `comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`project_id` integer NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` integer NOT NULL,
	`author_id` text,
	`body` text NOT NULL,
	`edited_at` integer,
	`attachments` text,
	`source` text,
	CONSTRAINT `fk_comments_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_comments_author_id_users_id_fk` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `comments_subject_type_subject_id_created_at_idx` ON `comments` (`subject_type`,`subject_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `comments_project_id_created_at_idx` ON `comments` (`project_id`,`created_at`);