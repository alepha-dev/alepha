CREATE TABLE `analytics_project_activity_raw` (
	`time_bucket` text NOT NULL,
	`project` text NOT NULL,
	`type` text NOT NULL,
	`action` text NOT NULL,
	`actor` text DEFAULT 'system' NOT NULL,
	`count` real NOT NULL
);
--> statement-breakpoint
CREATE TABLE `analytics_project_activity_rolled` (
	`time_bucket` text NOT NULL,
	`project` text NOT NULL,
	`type` text NOT NULL,
	`action` text NOT NULL,
	`actor` text DEFAULT 'system' NOT NULL,
	`count` real NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_project_activity_raw_time_bucket_action_actor_project_type_idx` ON `analytics_project_activity_raw` (`time_bucket`,`action`,`actor`,`project`,`type`);--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_project_activity_rolled_time_bucket_action_actor_project_type_idx` ON `analytics_project_activity_rolled` (`time_bucket`,`action`,`actor`,`project`,`type`);