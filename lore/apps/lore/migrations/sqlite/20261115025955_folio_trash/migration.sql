ALTER TABLE `folio_directories` ADD `system` text;--> statement-breakpoint
ALTER TABLE `folio_directories` ADD `trashed_at` integer;--> statement-breakpoint
ALTER TABLE `folios` ADD `trashed_at` integer;--> statement-breakpoint
CREATE INDEX `folio_directories_project_id_system_idx` ON `folio_directories` (`project_id`,`system`);