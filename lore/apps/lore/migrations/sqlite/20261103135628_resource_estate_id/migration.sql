ALTER TABLE `app_instances` ADD `resource_estate_id` text;--> statement-breakpoint
-- A copy already named is taken to run under that name on its current estate:
-- the best the rows can say, and what the Backups tab assumed until now. A copy
-- moved since and never redeployed is the one case this keeps open, until its
-- next deploy records the estate it really landed on.
UPDATE `app_instances` SET `resource_estate_id` = `estate_id` WHERE `resource_name` IS NOT NULL AND `estate_id` IS NOT NULL;
