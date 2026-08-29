ALTER TABLE `analytics_sigil_views_raw` ADD `browser` text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE `analytics_sigil_views_raw` ADD `os` text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE `analytics_sigil_views_rolled` ADD `browser` text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE `analytics_sigil_views_rolled` ADD `os` text DEFAULT 'other' NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS `analytics_sigil_views_raw_time_bucket_campaign_country_device_path_referrer_sigil_id_traffic_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `analytics_sigil_views_rolled_time_bucket_campaign_country_device_path_referrer_sigil_id_traffic_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_sigil_views_raw_time_bucket_browser_campaign_country_device_os_path_referrer_sigil_id_traffic_idx` ON `analytics_sigil_views_raw` (`time_bucket`,`browser`,`campaign`,`country`,`device`,`os`,`path`,`referrer`,`sigil_id`,`traffic`);--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_sigil_views_rolled_time_bucket_browser_campaign_country_device_os_path_referrer_sigil_id_traffic_idx` ON `analytics_sigil_views_rolled` (`time_bucket`,`browser`,`campaign`,`country`,`device`,`os`,`path`,`referrer`,`sigil_id`,`traffic`);