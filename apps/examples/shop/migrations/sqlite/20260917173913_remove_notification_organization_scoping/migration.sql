DROP INDEX IF EXISTS `notification_deliveries_organization_id_created_at_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `notification_suppressions_organization_id_channel_contact_reason_category_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `notification_suppressions_organization_id_channel_contact_idx`;--> statement-breakpoint
CREATE INDEX `notification_deliveries_created_at_idx` ON `notification_deliveries` (`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `notification_suppressions_channel_contact_reason_category_idx` ON `notification_suppressions` (`channel`,`contact`,`reason`,`category`);--> statement-breakpoint
CREATE INDEX `notification_suppressions_channel_contact_idx` ON `notification_suppressions` (`channel`,`contact`);--> statement-breakpoint
ALTER TABLE `notification_deliveries` DROP COLUMN `organization_id`;--> statement-breakpoint
ALTER TABLE `notification_inbox` DROP COLUMN `organization_id`;--> statement-breakpoint
ALTER TABLE `notification_suppressions` DROP COLUMN `organization_id`;