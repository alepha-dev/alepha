CREATE TABLE `prompt_queue` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`project_id` integer NOT NULL,
	`prompt` text NOT NULL,
	`key` text NOT NULL,
	`args` text,
	`host` text,
	`agent` text,
	`model` text,
	`user_id` text,
	`cause` text NOT NULL,
	`started_by_job_id` text,
	CONSTRAINT `fk_prompt_queue_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_prompt_queue_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
ALTER TABLE `prompts` ADD `concurrency` text;--> statement-breakpoint
CREATE UNIQUE INDEX `prompt_queue_project_id_prompt_key_idx` ON `prompt_queue` (`project_id`,`prompt`,`key`);--> statement-breakpoint
ALTER TABLE `prompts` DROP COLUMN `settle_seconds`;--> statement-breakpoint
ALTER TABLE `prompts` DROP COLUMN `pending`;--> statement-breakpoint
ALTER TABLE `prompts` DROP COLUMN `pending_job_id`;