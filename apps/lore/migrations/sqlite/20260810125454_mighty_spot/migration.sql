CREATE TABLE `analytics_sigil_views_raw` (
	`time_bucket` text NOT NULL,
	`sigil_id` text NOT NULL,
	`path` text NOT NULL,
	`country` text NOT NULL,
	`count` real NOT NULL
);
--> statement-breakpoint
CREATE TABLE `analytics_sigil_views_rolled` (
	`time_bucket` text NOT NULL,
	`sigil_id` text NOT NULL,
	`path` text NOT NULL,
	`country` text NOT NULL,
	`count` real NOT NULL
);
--> statement-breakpoint
CREATE TABLE `analytics_sigil_vitals_raw` (
	`time_bucket` text NOT NULL,
	`sigil_id` text NOT NULL,
	`metric` text NOT NULL,
	`path` text NOT NULL,
	`bucket` real NOT NULL,
	`samples` real NOT NULL
);
--> statement-breakpoint
CREATE TABLE `analytics_sigil_vitals_rolled` (
	`time_bucket` text NOT NULL,
	`sigil_id` text NOT NULL,
	`metric` text NOT NULL,
	`path` text NOT NULL,
	`bucket` real NOT NULL,
	`samples` real NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_sigil_views_raw_time_bucket_country_path_sigil_id_idx` ON `analytics_sigil_views_raw` (`time_bucket`,`country`,`path`,`sigil_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_sigil_views_rolled_time_bucket_country_path_sigil_id_idx` ON `analytics_sigil_views_rolled` (`time_bucket`,`country`,`path`,`sigil_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_sigil_vitals_raw_time_bucket_bucket_metric_path_sigil_id_idx` ON `analytics_sigil_vitals_raw` (`time_bucket`,`bucket`,`metric`,`path`,`sigil_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_sigil_vitals_rolled_time_bucket_bucket_metric_path_sigil_id_idx` ON `analytics_sigil_vitals_rolled` (`time_bucket`,`bucket`,`metric`,`path`,`sigil_id`);