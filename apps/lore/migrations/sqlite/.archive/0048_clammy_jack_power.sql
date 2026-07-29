PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_files` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`organization_id` text,
	`blob_id` text NOT NULL,
	`creator` text,
	`creator_realm` text,
	`creator_name` text,
	`bucket` text NOT NULL,
	`expiration_date` integer,
	`name` text NOT NULL,
	`original_name` text,
	`size` real NOT NULL,
	`mime_type` text NOT NULL,
	`tags` text,
	`checksum` text
);
--> statement-breakpoint
INSERT INTO `__new_files`("id", "version", "created_at", "updated_at", "organization_id", "blob_id", "creator", "creator_realm", "creator_name", "bucket", "expiration_date", "name", "original_name", "size", "mime_type", "tags", "checksum") SELECT "id", "version", "created_at", "updated_at", "organization_id", "blob_id", "creator", "creator_realm", "creator_name", "bucket", "expiration_date", "name", "original_name", "size", "mime_type", "tags", "checksum" FROM `files`;--> statement-breakpoint
DROP TABLE `files`;--> statement-breakpoint
ALTER TABLE `__new_files` RENAME TO `files`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `files_expiration_date_idx` ON `files` (`expiration_date`);--> statement-breakpoint
CREATE INDEX `files_bucket_idx` ON `files` (`bucket`);--> statement-breakpoint
CREATE INDEX `files_creator_idx` ON `files` (`creator`);--> statement-breakpoint
CREATE INDEX `files_created_at_idx` ON `files` (`created_at`);--> statement-breakpoint
CREATE INDEX `files_mime_type_idx` ON `files` (`mime_type`);--> statement-breakpoint
CREATE INDEX `files_bucket_created_at_idx` ON `files` (`bucket`,`created_at`);