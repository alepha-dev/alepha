CREATE TABLE `archive_blobs` (
	`file_id` text PRIMARY KEY NOT NULL,
	`short_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`campaign_id` integer NOT NULL,
	`directory_id` text,
	`name` text NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`directory_id`) REFERENCES `archive_directories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `archive_blobs_campaign_id_short_id_idx` ON `archive_blobs` (`campaign_id`,`short_id`);--> statement-breakpoint
CREATE INDEX `archive_blobs_directory_id_idx` ON `archive_blobs` (`directory_id`);--> statement-breakpoint
CREATE TABLE `archive_directories` (
	`id` text PRIMARY KEY NOT NULL,
	`short_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`campaign_id` integer NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `archive_directories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `archive_directories_campaign_id_short_id_idx` ON `archive_directories` (`campaign_id`,`short_id`);--> statement-breakpoint
CREATE INDEX `archive_directories_parent_id_idx` ON `archive_directories` (`parent_id`);--> statement-breakpoint
CREATE TABLE `archive_names` (
	`parent_directory_id` text,
	`root_scope` text,
	`lower_name` text NOT NULL,
	`kind` text NOT NULL,
	`entity_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `archive_names_parent_directory_id_root_scope_lower_name_idx` ON `archive_names` (`parent_directory_id`,`root_scope`,`lower_name`);--> statement-breakpoint
CREATE INDEX `archive_names_entity_id_idx` ON `archive_names` (`entity_id`);--> statement-breakpoint

-- Quest #66 hand-edit (option A from folio #4 §5): back up
-- folio_revisions before the folios rebuild. On D1, `PRAGMA
-- foreign_keys=OFF` is ignored — DROP TABLE folios below cascade-wipes
-- folio_revisions (and folio_links). folio_revisions carries
-- irreplaceable user state (Chronicles of the Folio, quest #63);
-- back up + restore. folio_links is derived and re-syncs on next
-- folio edit (see folioLinks entity comment).
CREATE TABLE `__bk_folio_revisions` AS SELECT * FROM `folio_revisions`;--> statement-breakpoint
DELETE FROM `folio_revisions`;--> statement-breakpoint

PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_folios` (
	`id` text PRIMARY KEY NOT NULL,
	`short_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`campaign_id` integer NOT NULL,
	`title` text NOT NULL,
	`protected` integer DEFAULT false NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`directory_id` text,
	`summary` text DEFAULT '' NOT NULL,
	`search_text` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`directory_id`) REFERENCES `archive_directories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- Quest #66 hand-edit: source row had `parent_id`, target has
-- `directory_id`. Old parent_id values pointed at folios.id and have
-- no semantic mapping to the new archive_directories tree, so we
-- drop them and land all migrated folios at the campaign root
-- (directory_id NULL).
INSERT INTO `__new_folios`("id", "short_id", "created_at", "updated_at", "campaign_id", "title", "protected", "content", "tags", "pinned", "directory_id", "summary", "search_text") SELECT "id", "short_id", "created_at", "updated_at", "campaign_id", "title", "protected", "content", "tags", "pinned", NULL, "summary", "search_text" FROM `folios`;--> statement-breakpoint
DROP TABLE `folios`;--> statement-breakpoint
ALTER TABLE `__new_folios` RENAME TO `folios`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `folios_campaign_id_updated_at_idx` ON `folios` (`campaign_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `folios_campaign_id_title_idx` ON `folios` (`campaign_id`,`title`);--> statement-breakpoint
CREATE UNIQUE INDEX `folios_campaign_id_short_id_idx` ON `folios` (`campaign_id`,`short_id`);--> statement-breakpoint

-- Quest #66 hand-edit: restore the folio_revisions rows wiped by the
-- folios rebuild. PK ids on folios survive the rebuild, so the
-- folio_id FK back-reference is valid and the re-insert is safe.
INSERT INTO `folio_revisions` SELECT * FROM `__bk_folio_revisions`;--> statement-breakpoint
DROP TABLE `__bk_folio_revisions`;