CREATE TABLE `analytics_sigil_requests_raw` (
	`time_bucket` text NOT NULL,
	`sigil_id` text NOT NULL,
	`route` text NOT NULL,
	`method` text NOT NULL,
	`status` text NOT NULL,
	`bucket` real NOT NULL,
	`samples` real NOT NULL,
	CONSTRAINT `fk_analytics_sigil_requests_raw_sigil_id_sigils_id_fk` FOREIGN KEY (`sigil_id`) REFERENCES `sigils`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `analytics_sigil_requests_rolled` (
	`time_bucket` text NOT NULL,
	`sigil_id` text NOT NULL,
	`route` text NOT NULL,
	`method` text NOT NULL,
	`status` text NOT NULL,
	`bucket` real NOT NULL,
	`samples` real NOT NULL,
	CONSTRAINT `fk_analytics_sigil_requests_rolled_sigil_id_sigils_id_fk` FOREIGN KEY (`sigil_id`) REFERENCES `sigils`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_sigil_requests_raw_time_bucket_bucket_method_route_sigil_id_status_idx` ON `analytics_sigil_requests_raw` (`time_bucket`,`bucket`,`method`,`route`,`sigil_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_sigil_requests_rolled_time_bucket_bucket_method_route_sigil_id_status_idx` ON `analytics_sigil_requests_rolled` (`time_bucket`,`bucket`,`method`,`route`,`sigil_id`,`status`);