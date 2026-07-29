CREATE TABLE `sigils` (
	`id` text PRIMARY KEY NOT NULL,
	`ingest_key` text NOT NULL,
	`campaign_id` integer NOT NULL,
	`label` text NOT NULL,
	`allowed_origins` text DEFAULT '[]' NOT NULL,
	`kinds` text DEFAULT '[]' NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `sigils_campaign_id_revoked_at_idx` ON `sigils` (`campaign_id`,`revoked_at`);--> statement-breakpoint
CREATE INDEX `sigils_created_by_idx` ON `sigils` (`created_by`);