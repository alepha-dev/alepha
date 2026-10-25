CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY,
	`project_id` integer NOT NULL,
	`app` text NOT NULL,
	`tag` text NOT NULL,
	`sha256` text NOT NULL,
	`file_id` text NOT NULL,
	`size_bytes` integer,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	CONSTRAINT `fk_artifacts_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_artifacts_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
ALTER TABLE `releases` RENAME TO `deployments`;--> statement-breakpoint
ALTER TABLE `deployments` ADD `artifact_id` text REFERENCES artifacts(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `deployments` ADD `tag` text;--> statement-breakpoint
DROP INDEX IF EXISTS `releases_project_id_app_environment_version_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `releases_project_id_status_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `releases_outpost_id_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `artifacts_project_id_app_tag_idx` ON `artifacts` (`project_id`,`app`,`tag`);--> statement-breakpoint
CREATE INDEX `artifacts_project_id_sha256_idx` ON `artifacts` (`project_id`,`sha256`);--> statement-breakpoint
CREATE UNIQUE INDEX `deployments_project_id_app_environment_version_idx` ON `deployments` (`project_id`,`app`,`environment`,`version`);--> statement-breakpoint
CREATE INDEX `deployments_project_id_status_idx` ON `deployments` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `deployments_outpost_id_idx` ON `deployments` (`outpost_id`);