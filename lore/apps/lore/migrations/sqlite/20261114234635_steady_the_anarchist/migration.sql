CREATE TABLE `folio_columns` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`folio_id` text NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`lower_name` text NOT NULL,
	`type` text NOT NULL,
	`options` text DEFAULT '{}' NOT NULL,
	CONSTRAINT `fk_folio_columns_folio_id_folios_id_fk` FOREIGN KEY (`folio_id`) REFERENCES `folios`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `folio_rows` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`folio_id` text NOT NULL,
	`number` integer NOT NULL,
	`position` real NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`cells` text DEFAULT '{}' NOT NULL,
	`search_text` text DEFAULT '' NOT NULL,
	`updated_by_user_id` text,
	CONSTRAINT `fk_folio_rows_folio_id_folios_id_fk` FOREIGN KEY (`folio_id`) REFERENCES `folios`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_folio_rows_updated_by_user_id_users_id_fk` FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
ALTER TABLE `folios` ADD `type` text DEFAULT 'text' NOT NULL;--> statement-breakpoint
CREATE INDEX `folio_columns_folio_id_position_idx` ON `folio_columns` (`folio_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `folio_columns_folio_id_lower_name_idx` ON `folio_columns` (`folio_id`,`lower_name`);--> statement-breakpoint
CREATE INDEX `folio_rows_folio_id_position_idx` ON `folio_rows` (`folio_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `folio_rows_folio_id_number_idx` ON `folio_rows` (`folio_id`,`number`);