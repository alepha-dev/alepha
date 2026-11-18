ALTER TABLE `automation_channels` RENAME TO `notification_channels`;--> statement-breakpoint
ALTER TABLE `event_subscriptions` ADD `channel_id` text REFERENCES notification_channels(id) ON DELETE CASCADE;--> statement-breakpoint
DROP INDEX IF EXISTS `automation_channels_project_id_name_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `notification_channels_project_id_name_idx` ON `notification_channels` (`project_id`,`name`);