CREATE TABLE `analytics_uptime_probes_raw` (
	`time_bucket` text NOT NULL,
	`monitor_id` text DEFAULT '00000000-0000-4000-8000-000000000000' NOT NULL,
	`result` text DEFAULT 'up' NOT NULL,
	`prober` text DEFAULT 'local' NOT NULL,
	`count` real NOT NULL,
	`up` real NOT NULL,
	`latency_ms` real NOT NULL,
	CONSTRAINT `fk_analytics_uptime_probes_raw_monitor_id_monitors_id_fk` FOREIGN KEY (`monitor_id`) REFERENCES `monitors`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `analytics_uptime_probes_rolled` (
	`time_bucket` text NOT NULL,
	`monitor_id` text DEFAULT '00000000-0000-4000-8000-000000000000' NOT NULL,
	`result` text DEFAULT 'up' NOT NULL,
	`prober` text DEFAULT 'local' NOT NULL,
	`count` real NOT NULL,
	`up` real NOT NULL,
	`latency_ms` real NOT NULL,
	CONSTRAINT `fk_analytics_uptime_probes_rolled_monitor_id_monitors_id_fk` FOREIGN KEY (`monitor_id`) REFERENCES `monitors`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_uptime_probes_raw_time_bucket_monitor_id_prober_result_idx` ON `analytics_uptime_probes_raw` (`time_bucket`,`monitor_id`,`prober`,`result`);--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_uptime_probes_rolled_time_bucket_monitor_id_prober_result_idx` ON `analytics_uptime_probes_rolled` (`time_bucket`,`monitor_id`,`prober`,`result`);