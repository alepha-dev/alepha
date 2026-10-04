-- #E74 / #Q2605: the three dead folio columns.
--
-- folios.tags and folio_revisions.tags_snapshot carry no index and no foreign
-- key, so each goes with a plain ALTER TABLE ... DROP COLUMN: `folios` is a
-- CASCADE parent and is NOT rebuilt.
--
-- folio_blobs.directory_id has a foreign key, which SQLite will not drop, so
-- folio_blobs is rebuilt. That is safe because it is a LEAF: no foreign key in
-- the previous snapshot points at it (migration-safety.spec.ts checks this
-- and refuses the migration otherwise). The rebuild keeps both remaining
-- foreign keys (projects, folios) and recreates both indexes.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_folio_blobs` (
	`file_id` text PRIMARY KEY,
	`short_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`project_id` integer NOT NULL,
	`folio_id` text NOT NULL,
	`name` text NOT NULL,
	CONSTRAINT `fk_archive_blobs_campaign_id_campaigns_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_folio_blobs_folio_id_folios_id_fk` FOREIGN KEY (`folio_id`) REFERENCES `folios`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__new_folio_blobs`(`file_id`, `short_id`, `created_at`, `updated_at`, `project_id`, `folio_id`, `name`) SELECT `file_id`, `short_id`, `created_at`, `updated_at`, `project_id`, `folio_id`, `name` FROM `folio_blobs`;--> statement-breakpoint
-- alepha-allow-drop-table: folio_blobs is a leaf, rebuilt to drop directory_id
DROP TABLE `folio_blobs`;--> statement-breakpoint
ALTER TABLE `__new_folio_blobs` RENAME TO `folio_blobs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `folio_blobs_project_id_short_id_idx` ON `folio_blobs` (`project_id`,`short_id`);--> statement-breakpoint
CREATE INDEX `folio_blobs_folio_id_idx` ON `folio_blobs` (`folio_id`);--> statement-breakpoint
ALTER TABLE `folio_revisions` DROP COLUMN `tags_snapshot`;--> statement-breakpoint
ALTER TABLE `folios` DROP COLUMN `tags`;