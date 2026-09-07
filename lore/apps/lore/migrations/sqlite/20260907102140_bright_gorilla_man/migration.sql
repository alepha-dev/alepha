CREATE TABLE `deployments` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`project_id` integer NOT NULL,
	`instance_id` text NOT NULL,
	`artifact_id` text,
	`app` text NOT NULL,
	`tag` text NOT NULL,
	`sha256` text NOT NULL,
	`status` text NOT NULL,
	`version_id` text,
	`url` text,
	`error` text,
	`log` text DEFAULT '[]' NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`created_by` text,
	CONSTRAINT `fk_deployments_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_deployments_instance_id_app_instances_id_fk` FOREIGN KEY (`instance_id`) REFERENCES `app_instances`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `deployments_instance_id_idx` ON `deployments` (`instance_id`);--> statement-breakpoint
CREATE INDEX `deployments_project_id_idx` ON `deployments` (`project_id`);