CREATE TABLE `estate_events` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`estate_id` text NOT NULL,
	`event_id` text NOT NULL,
	`kind` text NOT NULL,
	`app` text,
	`env` text,
	`at` text NOT NULL,
	`data` text,
	CONSTRAINT `fk_estate_events_estate_id_estates_id_fk` FOREIGN KEY (`estate_id`) REFERENCES `estates`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `app_instances` ADD `resource_estate_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `estate_events_estate_id_event_id_idx` ON `estate_events` (`estate_id`,`event_id`);--> statement-breakpoint
CREATE INDEX `estate_events_estate_id_app_env_at_idx` ON `estate_events` (`estate_id`,`app`,`env`,`at`);--> statement-breakpoint
-- A copy already named is taken to run under that name on its current estate:
-- the best the rows can say, and what the Backups tab assumed until now. A copy
-- moved since and never redeployed is the one case this keeps open, until its
-- next deploy records the estate it really landed on.
-- ⚠️ Only for a name no other copy holds, on any estate: two copies sharing a
-- name (one moved away from the estate the other runs on, say) cannot be told
-- apart from the rows, so neither is vouched for until it deploys again.
UPDATE `app_instances` SET `resource_estate_id` = `estate_id` WHERE `resource_name` IS NOT NULL AND `estate_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `app_instances` AS `other` WHERE `other`.`resource_name` = `app_instances`.`resource_name` AND `other`.`id` <> `app_instances`.`id`);
