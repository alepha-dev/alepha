CREATE TABLE `registry_credentials` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`project_id` integer NOT NULL,
	`host` text NOT NULL,
	`username` text NOT NULL,
	`secret_sealed` text NOT NULL,
	`key_version` integer DEFAULT 1 NOT NULL,
	`updated_by` text,
	CONSTRAINT `fk_registry_credentials_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `registry_credentials_project_id_host_idx` ON `registry_credentials` (`project_id`,`host`);