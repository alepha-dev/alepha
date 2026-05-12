CREATE TABLE `chapters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`project_id` integer NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`closed_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chapters_project_id_idx` ON `chapters` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `chapters_project_id_number_idx` ON `chapters` (`project_id`,`number`);--> statement-breakpoint
DROP INDEX `whiteboards_project_id_deleted_at_idx`;--> statement-breakpoint
CREATE INDEX `whiteboards_project_id_idx` ON `whiteboards` (`project_id`);--> statement-breakpoint
ALTER TABLE `whiteboards` DROP COLUMN `deleted_at`;--> statement-breakpoint
ALTER TABLE `tasks` ADD `chapter_id` integer REFERENCES chapters(id);--> statement-breakpoint
CREATE INDEX `tasks_accepted_by_idx` ON `tasks` (`accepted_by`);--> statement-breakpoint
CREATE INDEX `tasks_completed_by_idx` ON `tasks` (`completed_by`);--> statement-breakpoint
CREATE INDEX `tasks_chapter_id_idx` ON `tasks` (`chapter_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `characters_user_id_project_id_idx` ON `characters` (`user_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `invitations_invited_email_idx` ON `invitations` (`invited_email`);--> statement-breakpoint
CREATE INDEX `projects_created_by_idx` ON `projects` (`created_by`);
