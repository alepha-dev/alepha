CREATE TABLE `analytics_estate_stats_raw` (
	`time_bucket` text NOT NULL,
	`estate_id` text NOT NULL,
	`cpu` real NOT NULL,
	`memory` real NOT NULL,
	`samples` real NOT NULL,
	CONSTRAINT `fk_analytics_estate_stats_raw_estate_id_estates_id_fk` FOREIGN KEY (`estate_id`) REFERENCES `estates`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `analytics_estate_stats_rolled` (
	`time_bucket` text NOT NULL,
	`estate_id` text NOT NULL,
	`cpu` real NOT NULL,
	`memory` real NOT NULL,
	`samples` real NOT NULL,
	CONSTRAINT `fk_analytics_estate_stats_rolled_estate_id_estates_id_fk` FOREIGN KEY (`estate_id`) REFERENCES `estates`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_estate_stats_raw_time_bucket_estate_id_idx` ON `analytics_estate_stats_raw` (`time_bucket`,`estate_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_estate_stats_rolled_time_bucket_estate_id_idx` ON `analytics_estate_stats_rolled` (`time_bucket`,`estate_id`);