ALTER TABLE `characters` RENAME TO `members`;--> statement-breakpoint
DROP INDEX IF EXISTS `characters_user_id_campaign_id_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `members_user_id_campaign_id_idx` ON `members` (`user_id`,`campaign_id`);--> statement-breakpoint
ALTER TABLE `members` DROP COLUMN `xp`;--> statement-breakpoint
ALTER TABLE `members` DROP COLUMN `balance`;--> statement-breakpoint
ALTER TABLE `members` DROP COLUMN `alias`;--> statement-breakpoint
ALTER TABLE `members` DROP COLUMN `picture`;--> statement-breakpoint
ALTER TABLE `members` DROP COLUMN `equipped_title`;--> statement-breakpoint
ALTER TABLE `members` DROP COLUMN `achievements`;