CREATE TABLE `sigil_blight_rate` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sigil_id` text NOT NULL,
	`ip_hash` text NOT NULL,
	`date` text NOT NULL,
	`fingerprints` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sigil_blight_rate_sigil_id_ip_hash_date_idx` ON `sigil_blight_rate` (`sigil_id`,`ip_hash`,`date`);--> statement-breakpoint
CREATE TABLE `sigil_blights` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sigil_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`name` text NOT NULL,
	`message` text NOT NULL,
	`stack` text DEFAULT '' NOT NULL,
	`source_url` text DEFAULT '' NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`recent_ips` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	FOREIGN KEY (`sigil_id`) REFERENCES `sigils`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sigil_blights_sigil_id_fingerprint_idx` ON `sigil_blights` (`sigil_id`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `sigil_blights_sigil_id_status_idx` ON `sigil_blights` (`sigil_id`,`status`);