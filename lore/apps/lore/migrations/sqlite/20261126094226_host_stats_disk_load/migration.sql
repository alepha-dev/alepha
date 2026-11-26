ALTER TABLE `analytics_host_stats_raw` ADD `disk` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `analytics_host_stats_raw` ADD `disk_samples` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `analytics_host_stats_raw` ADD `load` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `analytics_host_stats_raw` ADD `load_samples` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `analytics_host_stats_rolled` ADD `disk` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `analytics_host_stats_rolled` ADD `disk_samples` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `analytics_host_stats_rolled` ADD `load` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `analytics_host_stats_rolled` ADD `load_samples` real DEFAULT 0 NOT NULL;