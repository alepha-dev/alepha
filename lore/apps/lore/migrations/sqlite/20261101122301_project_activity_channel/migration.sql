ALTER TABLE `analytics_project_activity_raw` ADD `channel` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `analytics_project_activity_rolled` ADD `channel` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS `analytics_project_activity_raw_time_bucket_action_actor_project_type_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `analytics_project_activity_rolled_time_bucket_action_actor_project_type_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_project_activity_raw_time_bucket_action_actor_channel_project_type_idx` ON `analytics_project_activity_raw` (`time_bucket`,`action`,`actor`,`channel`,`project`,`type`);--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_project_activity_rolled_time_bucket_action_actor_channel_project_type_idx` ON `analytics_project_activity_rolled` (`time_bucket`,`action`,`actor`,`channel`,`project`,`type`);