CREATE TABLE `blights` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`campaign_id` integer NOT NULL,
	`source_id` text,
	`fingerprint` text NOT NULL,
	`name` text NOT NULL,
	`message` text NOT NULL,
	`stack` text DEFAULT '' NOT NULL,
	`source_url` text DEFAULT '' NOT NULL,
	`release` text,
	`pulse_url` text,
	`origin` text DEFAULT 'client' NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	CONSTRAINT `fk_blights_campaign_id_campaigns_id_fk` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `campaign_sources` (
	`id` text PRIMARY KEY,
	`campaign_id` integer NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_prefix` text NOT NULL,
	`token_suffix` text DEFAULT '' NOT NULL,
	`scopes` text DEFAULT '["blight:write"]' NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`revoked_at` text,
	`last_seen_at` text,
	`expected_interval_minutes` integer,
	CONSTRAINT `fk_campaign_sources_campaign_id_campaigns_id_fk` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `blights_campaign_id_fingerprint_idx` ON `blights` (`campaign_id`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `blights_campaign_id_last_seen_at_idx` ON `blights` (`campaign_id`,`last_seen_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `campaign_sources_token_hash_idx` ON `campaign_sources` (`token_hash`);--> statement-breakpoint
CREATE INDEX `campaign_sources_campaign_id_idx` ON `campaign_sources` (`campaign_id`);