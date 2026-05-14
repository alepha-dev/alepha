CREATE TABLE `folio_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`from_id` text NOT NULL,
	`to_id` text NOT NULL,
	FOREIGN KEY (`from_id`) REFERENCES `folios`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_id`) REFERENCES `folios`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `folio_links_from_id_to_id_idx` ON `folio_links` (`from_id`,`to_id`);--> statement-breakpoint
CREATE INDEX `folio_links_to_id_idx` ON `folio_links` (`to_id`);