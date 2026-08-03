CREATE TABLE `releases` (
	`id` text PRIMARY KEY,
	`campaign_id` integer NOT NULL,
	`app` text NOT NULL,
	`environment` text NOT NULL,
	`version` text NOT NULL,
	`sha256` text NOT NULL,
	`file_id` text NOT NULL,
	`size_bytes` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`failure_reason` text,
	`outpost_id` text,
	`claimed_at` text,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	CONSTRAINT `fk_releases_campaign_id_campaigns_id_fk` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_releases_outpost_id_outposts_id_fk` FOREIGN KEY (`outpost_id`) REFERENCES `outposts`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_releases_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `releases_campaign_id_app_environment_version_idx` ON `releases` (`campaign_id`,`app`,`environment`,`version`);--> statement-breakpoint
CREATE INDEX `releases_campaign_id_status_idx` ON `releases` (`campaign_id`,`status`);--> statement-breakpoint
CREATE INDEX `releases_outpost_id_idx` ON `releases` (`outpost_id`);