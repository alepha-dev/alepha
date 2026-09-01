CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`project_id` integer NOT NULL,
	`app` text NOT NULL,
	`tag` text NOT NULL,
	`runtime` text NOT NULL,
	`sha256` text NOT NULL,
	`size` integer NOT NULL,
	`file_id` text NOT NULL,
	`commit_sha` text,
	CONSTRAINT `fk_artifacts_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `artifacts_project_id_app_tag_runtime_idx` ON `artifacts` (`project_id`,`app`,`tag`,`runtime`);--> statement-breakpoint
CREATE INDEX `artifacts_project_id_tag_idx` ON `artifacts` (`project_id`,`tag`);--> statement-breakpoint
CREATE INDEX `artifacts_project_id_app_idx` ON `artifacts` (`project_id`,`app`);