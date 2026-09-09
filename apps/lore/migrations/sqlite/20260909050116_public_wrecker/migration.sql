ALTER TABLE `artifacts` ADD `format` text DEFAULT 'archive' NOT NULL;--> statement-breakpoint
ALTER TABLE `artifacts` ADD `reference` text;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_artifacts` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`project_id` integer NOT NULL,
	`app` text NOT NULL,
	`tag` text NOT NULL,
	`runtime` text NOT NULL,
	`format` text DEFAULT 'archive' NOT NULL,
	`reference` text,
	`sha256` text NOT NULL,
	`size` integer,
	`file_id` text,
	`commit_sha` text,
	`maps_file_id` text,
	`manifest` text,
	CONSTRAINT `fk_artifacts_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
--
-- The two ADDs above are additive and need no rebuild. This rebuild exists for
-- one reason: `size` and `file_id` were NOT NULL and an image row has neither
-- (Lore stores a reference, never bytes), and SQLite has no ALTER COLUMN.
--
-- Note the INSERT does not carry `format` or `reference`. It does not need to:
-- the ADD on line 1 already backfilled every existing row to 'archive' via the
-- DDL default, and `__new_artifacts` carries the same default, so there is no
-- window in which a row reads as neither format and no separate UPDATE.
--
INSERT INTO `__new_artifacts`(`id`, `created_at`, `updated_at`, `project_id`, `app`, `tag`, `runtime`, `sha256`, `size`, `file_id`, `commit_sha`, `maps_file_id`, `manifest`) SELECT `id`, `created_at`, `updated_at`, `project_id`, `app`, `tag`, `runtime`, `sha256`, `size`, `file_id`, `commit_sha`, `maps_file_id`, `manifest` FROM `artifacts`;--> statement-breakpoint
-- alepha-allow-drop-table: reviewed line by line for epic #E47, quest #Q2115.
--
-- ⚠️ FINDING, TRUE ON 2026-09-09 AND NOT FOREVER: nothing references
-- `artifacts`. `grep -rn "artifacts.cols" src/api/entities/` finds nothing, no
-- migration in this directory contains `REFERENCES \`artifacts\``, and
-- `deployments.artifactId` is a soft uuid with no foreign key, deliberately.
-- So this DROP has no ON DELETE CASCADE children, and the 2026-05 D1
-- cascade-wipe cannot repeat on this table.
--
-- This stops being true the day any entity takes a `db.ref` onto
-- `artifacts.cols.id`. Re-derive it before the next rebuild of this table
-- rather than trusting this comment: it is a record of one review, not a
-- standing guarantee.
DROP TABLE `artifacts`;--> statement-breakpoint
ALTER TABLE `__new_artifacts` RENAME TO `artifacts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
DROP INDEX IF EXISTS `artifacts_project_id_app_tag_runtime_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `artifacts_project_id_app_tag_runtime_format_idx` ON `artifacts` (`project_id`,`app`,`tag`,`runtime`,`format`);--> statement-breakpoint
CREATE INDEX `artifacts_project_id_tag_idx` ON `artifacts` (`project_id`,`tag`);--> statement-breakpoint
CREATE INDEX `artifacts_project_id_app_idx` ON `artifacts` (`project_id`,`app`);