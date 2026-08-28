CREATE TABLE `notification_suppressions` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`organization_id` text,
	`contact` text NOT NULL,
	`channel` text NOT NULL,
	`reason` text NOT NULL,
	`category` text DEFAULT '*' NOT NULL,
	`source` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_suppressions_organization_id_channel_contact_reason_category_idx` ON `notification_suppressions` (`organization_id`,`channel`,`contact`,`reason`,`category`);--> statement-breakpoint
CREATE INDEX `notification_suppressions_organization_id_channel_contact_idx` ON `notification_suppressions` (`organization_id`,`channel`,`contact`);