PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_archive_names` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_directory_id` text,
	`root_scope` text,
	`lower_name` text NOT NULL,
	`kind` text NOT NULL,
	`entity_id` text NOT NULL
);
--> statement-breakpoint
-- Backfill: `archive_names` had no `id` column before this migration, so
-- synthesize a UUIDv4 per existing row. SQLite has no built-in uuid() —
-- compose the canonical 8-4-4-4-12 hex form with the v4/variant bits set.
INSERT INTO `__new_archive_names`("id", "parent_directory_id", "root_scope", "lower_name", "kind", "entity_id")
SELECT
  lower(hex(randomblob(4))) || '-' ||
  lower(hex(randomblob(2))) || '-4' ||
  substr(lower(hex(randomblob(2))), 2) || '-' ||
  substr('89ab', 1 + (abs(random()) % 4), 1) ||
  substr(lower(hex(randomblob(2))), 2) || '-' ||
  lower(hex(randomblob(6))),
  "parent_directory_id", "root_scope", "lower_name", "kind", "entity_id"
FROM `archive_names`;--> statement-breakpoint
DROP TABLE `archive_names`;--> statement-breakpoint
ALTER TABLE `__new_archive_names` RENAME TO `archive_names`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `archive_names_parent_directory_id_root_scope_lower_name_idx` ON `archive_names` (`parent_directory_id`,`root_scope`,`lower_name`);--> statement-breakpoint
CREATE INDEX `archive_names_entity_id_idx` ON `archive_names` (`entity_id`);