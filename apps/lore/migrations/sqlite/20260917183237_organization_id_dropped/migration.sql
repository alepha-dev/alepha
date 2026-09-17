DROP INDEX IF EXISTS `notification_deliveries_organization_id_created_at_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `notification_suppressions_organization_id_channel_contact_reason_category_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `notification_suppressions_organization_id_channel_contact_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `parameters_organization_id_name_activation_date_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `parameters_organization_id_name_version_idx`;--> statement-breakpoint
CREATE INDEX `notification_deliveries_created_at_idx` ON `notification_deliveries` (`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `notification_suppressions_channel_contact_reason_category_idx` ON `notification_suppressions` (`channel`,`contact`,`reason`,`category`);--> statement-breakpoint
CREATE INDEX `notification_suppressions_channel_contact_idx` ON `notification_suppressions` (`channel`,`contact`);--> statement-breakpoint
CREATE INDEX `parameters_name_activation_date_idx` ON `parameters` (`name`,`activation_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `parameters_name_version_idx` ON `parameters` (`name`,`version`);--> statement-breakpoint
ALTER TABLE `api_keys` DROP COLUMN `organization_id`;--> statement-breakpoint
ALTER TABLE `audits` DROP COLUMN `organization_id`;--> statement-breakpoint
ALTER TABLE `files` DROP COLUMN `organization_id`;--> statement-breakpoint
ALTER TABLE `invitations` DROP COLUMN `organization_id`;--> statement-breakpoint
ALTER TABLE `job_executions` DROP COLUMN `organization_id`;--> statement-breakpoint
ALTER TABLE `notification_deliveries` DROP COLUMN `organization_id`;--> statement-breakpoint
ALTER TABLE `notification_inbox` DROP COLUMN `organization_id`;--> statement-breakpoint
ALTER TABLE `notification_suppressions` DROP COLUMN `organization_id`;--> statement-breakpoint
ALTER TABLE `parameters` DROP COLUMN `organization_id`;--> statement-breakpoint
ALTER TABLE `rank_definitions` DROP COLUMN `organization_id`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `organization_id`;