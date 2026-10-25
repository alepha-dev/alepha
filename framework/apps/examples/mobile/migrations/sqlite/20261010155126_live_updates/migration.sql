CREATE TABLE `files` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
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
CREATE TABLE `ota_apps` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`app_id` text NOT NULL,
	`name` text NOT NULL,
	`public_key` text NOT NULL,
	`key_id` text NOT NULL,
	`default_channel` text DEFAULT 'production' NOT NULL,
	`publisher_key_ids` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ota_bundles` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`app_ref` text NOT NULL,
	`platform` text NOT NULL,
	`variant` text NOT NULL,
	`version` text NOT NULL,
	`channel` text NOT NULL,
	`builds` text NOT NULL,
	`fingerprint` text NOT NULL,
	`key_id` text NOT NULL,
	`archive_sha256` text NOT NULL,
	`expanded_size` integer NOT NULL,
	`files` integer NOT NULL,
	`checksum` text NOT NULL,
	`session_key` text NOT NULL,
	`ciphertext_sha256` text NOT NULL,
	`size` integer NOT NULL,
	`status` text NOT NULL,
	`file_id` text,
	`killed_at` integer,
	`killed_reason` text,
	`last_link_at` integer,
	CONSTRAINT `fk_ota_bundles_app_ref_ota_apps_id_fk` FOREIGN KEY (`app_ref`) REFERENCES `ota_apps`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `ota_channels` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`app_ref` text NOT NULL,
	`name` text NOT NULL,
	`allow_self_assign` integer DEFAULT false NOT NULL,
	`cohorts` text DEFAULT '{}' NOT NULL,
	CONSTRAINT `fk_ota_channels_app_ref_ota_apps_id_fk` FOREIGN KEY (`app_ref`) REFERENCES `ota_apps`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `ota_device_overrides` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`app_ref` text NOT NULL,
	`device_id` text NOT NULL,
	`channel` text,
	`bundle_id` text,
	`note` text,
	CONSTRAINT `fk_ota_device_overrides_app_ref_ota_apps_id_fk` FOREIGN KEY (`app_ref`) REFERENCES `ota_apps`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `ota_devices` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`app_ref` text NOT NULL,
	`device_id` text NOT NULL,
	`platform` text NOT NULL,
	`version_code` text NOT NULL,
	`version_build` text,
	`version_name` text NOT NULL,
	`channel` text,
	`plugin_version` text,
	`is_emulator` integer,
	`failed_versions` text DEFAULT '[]' NOT NULL,
	`last_seen_at` integer NOT NULL,
	CONSTRAINT `fk_ota_devices_app_ref_ota_apps_id_fk` FOREIGN KEY (`app_ref`) REFERENCES `ota_apps`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `files_expiration_date_idx` ON `files` (`expiration_date`);--> statement-breakpoint
CREATE INDEX `files_bucket_idx` ON `files` (`bucket`);--> statement-breakpoint
CREATE INDEX `files_creator_idx` ON `files` (`creator`);--> statement-breakpoint
CREATE INDEX `files_created_at_idx` ON `files` (`created_at`);--> statement-breakpoint
CREATE INDEX `files_mime_type_idx` ON `files` (`mime_type`);--> statement-breakpoint
CREATE INDEX `files_bucket_created_at_idx` ON `files` (`bucket`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `ota_apps_app_id_idx` ON `ota_apps` (`app_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ota_bundles_app_ref_platform_version_idx` ON `ota_bundles` (`app_ref`,`platform`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `ota_channels_app_ref_name_idx` ON `ota_channels` (`app_ref`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `ota_device_overrides_app_ref_device_id_idx` ON `ota_device_overrides` (`app_ref`,`device_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ota_devices_app_ref_device_id_idx` ON `ota_devices` (`app_ref`,`device_id`);