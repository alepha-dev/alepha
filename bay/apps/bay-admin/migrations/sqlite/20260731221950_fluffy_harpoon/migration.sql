CREATE TABLE `app_usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`app_key` text NOT NULL,
	`at` text NOT NULL,
	`running` integer NOT NULL,
	`memory_bytes` integer,
	`cpu_seconds` real,
	`tasks` integer,
	`restarts` integer
);
--> statement-breakpoint
DROP INDEX IF EXISTS `error_groups_app_id_fingerprint_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `error_groups_app_id_last_seen_at_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `heartbeats_app_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `lore_outbox_app_id_created_at_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `metrics_points_app_id_series_at_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `pulse_apps_slug_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `pulse_apps_ingest_key_hash_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `uniques_daily_app_id_day_visitor_hash_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `uniques_daily_app_id_day_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `views_hourly_app_id_hour_path_country_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `views_hourly_app_id_hour_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `vitals_hourly_app_id_hour_metric_path_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `vitals_hourly_app_id_hour_idx`;--> statement-breakpoint
CREATE INDEX `app_usage_app_key_at_idx` ON `app_usage` (`app_key`,`at`);--> statement-breakpoint
DROP TABLE `error_groups`;--> statement-breakpoint
DROP TABLE `heartbeats`;--> statement-breakpoint
DROP TABLE `lore_outbox`;--> statement-breakpoint
DROP TABLE `metrics_points`;--> statement-breakpoint
DROP TABLE `pulse_apps`;--> statement-breakpoint
DROP TABLE `uniques_daily`;--> statement-breakpoint
DROP TABLE `views_hourly`;--> statement-breakpoint
DROP TABLE `vitals_hourly`;