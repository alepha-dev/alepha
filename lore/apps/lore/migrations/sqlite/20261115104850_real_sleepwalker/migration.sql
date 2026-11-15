CREATE TABLE `folio_views` (
	`id` text PRIMARY KEY,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`folio_id` text NOT NULL,
	`kind` text NOT NULL,
	`date_column_id` text,
	`title_column_id` text,
	CONSTRAINT `fk_folio_views_folio_id_folios_id_fk` FOREIGN KEY (`folio_id`) REFERENCES `folios`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `folio_views_folio_id_idx` ON `folio_views` (`folio_id`);