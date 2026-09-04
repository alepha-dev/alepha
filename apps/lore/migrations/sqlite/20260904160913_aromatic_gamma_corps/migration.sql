CREATE TABLE `analytics_sigil_errors_raw` (
	`time_bucket` text NOT NULL,
	`sigil_id` text NOT NULL,
	`origin` text DEFAULT 'client' NOT NULL,
	`fingerprint` text DEFAULT '' NOT NULL,
	`count` real NOT NULL,
	CONSTRAINT `fk_analytics_sigil_errors_raw_sigil_id_sigils_id_fk` FOREIGN KEY (`sigil_id`) REFERENCES `sigils`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `analytics_sigil_errors_rolled` (
	`time_bucket` text NOT NULL,
	`sigil_id` text NOT NULL,
	`origin` text DEFAULT 'client' NOT NULL,
	`fingerprint` text DEFAULT '' NOT NULL,
	`count` real NOT NULL,
	CONSTRAINT `fk_analytics_sigil_errors_rolled_sigil_id_sigils_id_fk` FOREIGN KEY (`sigil_id`) REFERENCES `sigils`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_sigil_errors_raw_time_bucket_fingerprint_origin_sigil_id_idx` ON `analytics_sigil_errors_raw` (`time_bucket`,`fingerprint`,`origin`,`sigil_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_sigil_errors_rolled_time_bucket_fingerprint_origin_sigil_id_idx` ON `analytics_sigil_errors_rolled` (`time_bucket`,`fingerprint`,`origin`,`sigil_id`);