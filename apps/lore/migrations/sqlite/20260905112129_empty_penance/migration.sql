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
CREATE TABLE `estate_commands` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`estate_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`payload` text NOT NULL,
	`requested_by` text,
	`timeout_seconds` integer NOT NULL,
	`sent_at` text,
	`running_at` text,
	`finished_at` text,
	`step` text,
	`reason` text,
	CONSTRAINT `fk_estate_commands_estate_id_estates_id_fk` FOREIGN KEY (`estate_id`) REFERENCES `estates`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_estate_commands_requested_by_users_id_fk` FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `estate_projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`estate_id` text NOT NULL,
	`project_id` integer NOT NULL,
	`created_by` text,
	CONSTRAINT `fk_estate_projects_estate_id_estates_id_fk` FOREIGN KEY (`estate_id`) REFERENCES `estates`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_estate_projects_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_estate_projects_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `estates` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`owner_user_id` text NOT NULL,
	`type` text NOT NULL,
	`slug` text NOT NULL,
	`label` text,
	`secret_hash` text,
	`secret_prefix` text,
	`collect_series` integer DEFAULT false NOT NULL,
	`deploy_allowed` integer DEFAULT false NOT NULL,
	`stats_interval_seconds` integer DEFAULT 1800 NOT NULL,
	`connected_at` text,
	`disconnected_at` text,
	`connection_id` text,
	`last_seen_at` text,
	`cpu_percent` real,
	`memory_percent` real,
	`stats_at` text,
	CONSTRAINT `fk_estates_owner_user_id_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_estate_stats_raw_time_bucket_estate_id_idx` ON `analytics_estate_stats_raw` (`time_bucket`,`estate_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_estate_stats_rolled_time_bucket_estate_id_idx` ON `analytics_estate_stats_rolled` (`time_bucket`,`estate_id`);--> statement-breakpoint
CREATE INDEX `estate_commands_estate_id_status_idx` ON `estate_commands` (`estate_id`,`status`);--> statement-breakpoint
CREATE INDEX `estate_commands_estate_id_created_at_idx` ON `estate_commands` (`estate_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `estate_projects_estate_id_project_id_idx` ON `estate_projects` (`estate_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `estate_projects_project_id_idx` ON `estate_projects` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `estates_owner_user_id_slug_idx` ON `estates` (`owner_user_id`,`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `estates_secret_hash_idx` ON `estates` (`secret_hash`);