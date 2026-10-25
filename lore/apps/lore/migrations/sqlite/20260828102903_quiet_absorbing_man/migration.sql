CREATE TABLE `notification_deliveries` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`execution_id` text NOT NULL,
	`organization_id` text,
	`message_id` text,
	`provider` text NOT NULL,
	`channel` text NOT NULL,
	`contact` text NOT NULL,
	`template` text NOT NULL,
	`category` text,
	`critical` integer DEFAULT false NOT NULL,
	`status` text NOT NULL,
	`skip_reason` text,
	`subject` text,
	`body` text,
	`last_event_at` integer,
	`smtp_status_code` text,
	`error` text
);
--> statement-breakpoint
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
CREATE UNIQUE INDEX `notification_deliveries_execution_id_idx` ON `notification_deliveries` (`execution_id`);--> statement-breakpoint
CREATE INDEX `notification_deliveries_message_id_idx` ON `notification_deliveries` (`message_id`);--> statement-breakpoint
CREATE INDEX `notification_deliveries_organization_id_created_at_idx` ON `notification_deliveries` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `notification_suppressions_organization_id_channel_contact_reason_category_idx` ON `notification_suppressions` (`organization_id`,`channel`,`contact`,`reason`,`category`);--> statement-breakpoint
CREATE INDEX `notification_suppressions_organization_id_channel_contact_idx` ON `notification_suppressions` (`organization_id`,`channel`,`contact`);