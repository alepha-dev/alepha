ALTER TABLE `analytics_sigil_views_raw` ADD `referrer` text DEFAULT 'direct' NOT NULL;--> statement-breakpoint
ALTER TABLE `analytics_sigil_views_raw` ADD `campaign` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `analytics_sigil_views_raw` ADD `device` text DEFAULT 'desktop' NOT NULL;--> statement-breakpoint
ALTER TABLE `analytics_sigil_views_raw` ADD `engaged` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `analytics_sigil_views_raw` ADD `entries` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `analytics_sigil_views_rolled` ADD `referrer` text DEFAULT 'direct' NOT NULL;--> statement-breakpoint
ALTER TABLE `analytics_sigil_views_rolled` ADD `campaign` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `analytics_sigil_views_rolled` ADD `device` text DEFAULT 'desktop' NOT NULL;--> statement-breakpoint
ALTER TABLE `analytics_sigil_views_rolled` ADD `engaged` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `analytics_sigil_views_rolled` ADD `entries` real DEFAULT 0 NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS `analytics_sigil_views_raw_time_bucket_country_path_sigil_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `analytics_sigil_views_rolled_time_bucket_country_path_sigil_id_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_sigil_views_raw_time_bucket_campaign_country_device_path_referrer_sigil_id_idx` ON `analytics_sigil_views_raw` (`time_bucket`,`campaign`,`country`,`device`,`path`,`referrer`,`sigil_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_sigil_views_rolled_time_bucket_campaign_country_device_path_referrer_sigil_id_idx` ON `analytics_sigil_views_rolled` (`time_bucket`,`campaign`,`country`,`device`,`path`,`referrer`,`sigil_id`);