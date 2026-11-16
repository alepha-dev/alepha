CREATE TABLE `requirements` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`deleted_at` integer,
	`project_id` integer NOT NULL,
	`number` integer NOT NULL,
	`statement` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`type` text DEFAULT 'functional' NOT NULL,
	`priority` text DEFAULT 'should' NOT NULL,
	`chapter` text,
	`paragraph` text,
	`source_folio_id` text,
	`source_anchor` text,
	`source_revision_id` text,
	`target_release_id` integer,
	CONSTRAINT `fk_requirements_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_requirements_target_release_id_releases_id_fk` FOREIGN KEY (`target_release_id`) REFERENCES `releases`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `requirements_project_id_number_idx` ON `requirements` (`project_id`,`number`);