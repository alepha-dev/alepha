CREATE TABLE `job_keys` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`api_key_id` text NOT NULL,
	`job_id` text NOT NULL,
	`project_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`tools` text NOT NULL,
	`quest_number` integer,
	`feedback_number` integer,
	`repository_id` text,
	`write_ref_prefix` text,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	CONSTRAINT `fk_job_keys_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_keys_api_key_id_idx` ON `job_keys` (`api_key_id`);--> statement-breakpoint
CREATE INDEX `job_keys_job_id_idx` ON `job_keys` (`job_id`);