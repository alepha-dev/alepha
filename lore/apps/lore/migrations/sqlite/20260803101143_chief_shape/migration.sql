CREATE TABLE `outpost_apps` (
	`id` text PRIMARY KEY,
	`outpost_id` text NOT NULL,
	`app` text NOT NULL,
	`environment` text NOT NULL,
	`domains` text DEFAULT '[]' NOT NULL,
	`release` text,
	`running` integer DEFAULT false NOT NULL,
	`memory_bytes` integer,
	`restarts` integer DEFAULT 0 NOT NULL,
	`last_request_at` text,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_outpost_apps_outpost_id_outposts_id_fk` FOREIGN KEY (`outpost_id`) REFERENCES `outposts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `outpost_events` (
	`id` text PRIMARY KEY,
	`outpost_id` text NOT NULL,
	`app` text NOT NULL,
	`environment` text NOT NULL,
	`kind` text NOT NULL,
	`release` text,
	`occurred_at` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	CONSTRAINT `fk_outpost_events_outpost_id_outposts_id_fk` FOREIGN KEY (`outpost_id`) REFERENCES `outposts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `outposts` (
	`id` text PRIMARY KEY,
	`campaign_id` integer NOT NULL,
	`label` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_prefix` text NOT NULL,
	`agent` text,
	`base_domain` text,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`last_seen_at` text,
	CONSTRAINT `fk_outposts_campaign_id_campaigns_id_fk` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_outposts_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `outpost_apps_outpost_id_idx` ON `outpost_apps` (`outpost_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `outpost_apps_outpost_id_app_environment_idx` ON `outpost_apps` (`outpost_id`,`app`,`environment`);--> statement-breakpoint
CREATE INDEX `outpost_apps_app_environment_idx` ON `outpost_apps` (`app`,`environment`);--> statement-breakpoint
CREATE INDEX `outpost_events_outpost_id_idx` ON `outpost_events` (`outpost_id`);--> statement-breakpoint
CREATE INDEX `outpost_events_app_environment_occurred_at_idx` ON `outpost_events` (`app`,`environment`,`occurred_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `outpost_events_outpost_id_app_environment_kind_occurred_at_idx` ON `outpost_events` (`outpost_id`,`app`,`environment`,`kind`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `outposts_campaign_id_idx` ON `outposts` (`campaign_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `outposts_token_hash_idx` ON `outposts` (`token_hash`);--> statement-breakpoint
CREATE INDEX `outposts_created_by_idx` ON `outposts` (`created_by`);