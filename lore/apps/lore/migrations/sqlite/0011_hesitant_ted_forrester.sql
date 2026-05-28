PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_folio_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`from_id` text NOT NULL,
	`to_id` text NOT NULL,
	`target_type` text DEFAULT 'folio' NOT NULL,
	FOREIGN KEY (`from_id`) REFERENCES `folios`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- Hand-edited: drop `target_type` from the SELECT — old rows don't have
-- the column. The destination column carries a `DEFAULT 'folio'` so
-- existing rows backfill correctly without explicit projection.
INSERT INTO `__new_folio_links`("id", "created_at", "from_id", "to_id") SELECT "id", "created_at", "from_id", "to_id" FROM `folio_links`;--> statement-breakpoint
DROP TABLE `folio_links`;--> statement-breakpoint
ALTER TABLE `__new_folio_links` RENAME TO `folio_links`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `folio_links_from_id_to_id_idx` ON `folio_links` (`from_id`,`to_id`);--> statement-breakpoint
CREATE INDEX `folio_links_to_id_idx` ON `folio_links` (`to_id`);