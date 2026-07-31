CREATE TABLE `error_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`app_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`name` text NOT NULL,
	`message` text NOT NULL,
	`stack_sample` text NOT NULL,
	`source_url` text NOT NULL,
	`release` text,
	`origin` text DEFAULT 'client' NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`forwarded_at` text,
	CONSTRAINT `fk_error_groups_app_id_pulse_apps_id_fk` FOREIGN KEY (`app_id`) REFERENCES `pulse_apps`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `heartbeats` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`app_id` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`release` text,
	`uptime_sec` real,
	`idle` integer,
	CONSTRAINT `fk_heartbeats_app_id_pulse_apps_id_fk` FOREIGN KEY (`app_id`) REFERENCES `pulse_apps`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `lore_outbox` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`app_id` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	CONSTRAINT `fk_lore_outbox_app_id_pulse_apps_id_fk` FOREIGN KEY (`app_id`) REFERENCES `pulse_apps`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `metrics_points` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`app_id` text NOT NULL,
	`series` text NOT NULL,
	`at` text NOT NULL,
	`value` real NOT NULL,
	CONSTRAINT `fk_metrics_points_app_id_pulse_apps_id_fk` FOREIGN KEY (`app_id`) REFERENCES `pulse_apps`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `pulse_apps` (
	`id` text PRIMARY KEY,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`ingest_key_hash` text NOT NULL,
	`ingest_key_prefix` text NOT NULL,
	`appetite` text DEFAULT '{}' NOT NULL,
	`petition_url` text,
	`lore` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE TABLE `uniques_daily` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`app_id` text NOT NULL,
	`day` text NOT NULL,
	`visitor_hash` text NOT NULL,
	CONSTRAINT `fk_uniques_daily_app_id_pulse_apps_id_fk` FOREIGN KEY (`app_id`) REFERENCES `pulse_apps`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `views_hourly` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`app_id` text NOT NULL,
	`hour` text NOT NULL,
	`path` text NOT NULL,
	`country` text DEFAULT 'ZZ' NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	CONSTRAINT `fk_views_hourly_app_id_pulse_apps_id_fk` FOREIGN KEY (`app_id`) REFERENCES `pulse_apps`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `vitals_hourly` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`app_id` text NOT NULL,
	`hour` text NOT NULL,
	`metric` text NOT NULL,
	`path` text NOT NULL,
	`bucket_counts` text DEFAULT '{}' NOT NULL,
	CONSTRAINT `fk_vitals_hourly_app_id_pulse_apps_id_fk` FOREIGN KEY (`app_id`) REFERENCES `pulse_apps`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `error_groups_app_id_fingerprint_idx` ON `error_groups` (`app_id`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `error_groups_app_id_last_seen_at_idx` ON `error_groups` (`app_id`,`last_seen_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `heartbeats_app_id_idx` ON `heartbeats` (`app_id`);--> statement-breakpoint
CREATE INDEX `lore_outbox_app_id_created_at_idx` ON `lore_outbox` (`app_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `metrics_points_app_id_series_at_idx` ON `metrics_points` (`app_id`,`series`,`at`);--> statement-breakpoint
CREATE UNIQUE INDEX `pulse_apps_slug_idx` ON `pulse_apps` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `pulse_apps_ingest_key_hash_idx` ON `pulse_apps` (`ingest_key_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniques_daily_app_id_day_visitor_hash_idx` ON `uniques_daily` (`app_id`,`day`,`visitor_hash`);--> statement-breakpoint
CREATE INDEX `uniques_daily_app_id_day_idx` ON `uniques_daily` (`app_id`,`day`);--> statement-breakpoint
CREATE UNIQUE INDEX `views_hourly_app_id_hour_path_country_idx` ON `views_hourly` (`app_id`,`hour`,`path`,`country`);--> statement-breakpoint
CREATE INDEX `views_hourly_app_id_hour_idx` ON `views_hourly` (`app_id`,`hour`);--> statement-breakpoint
CREATE UNIQUE INDEX `vitals_hourly_app_id_hour_metric_path_idx` ON `vitals_hourly` (`app_id`,`hour`,`metric`,`path`);--> statement-breakpoint
CREATE INDEX `vitals_hourly_app_id_hour_idx` ON `vitals_hourly` (`app_id`,`hour`);