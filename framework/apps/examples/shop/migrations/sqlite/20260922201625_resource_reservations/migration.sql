CREATE TABLE `commerce_resource_reservations` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`resource_id` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`quantity` integer NOT NULL,
	`order_id` text,
	`order_item_id` text,
	`label` text,
	`status` text DEFAULT 'held' NOT NULL,
	`expires_at` text
);
--> statement-breakpoint
CREATE INDEX `commerce_resource_reservations_resource_id_status_idx` ON `commerce_resource_reservations` (`resource_id`,`status`);--> statement-breakpoint
CREATE INDEX `commerce_resource_reservations_order_id_idx` ON `commerce_resource_reservations` (`order_id`);--> statement-breakpoint
CREATE INDEX `commerce_resource_reservations_order_item_id_idx` ON `commerce_resource_reservations` (`order_item_id`);--> statement-breakpoint
CREATE INDEX `commerce_resource_reservations_status_expires_at_idx` ON `commerce_resource_reservations` (`status`,`expires_at`);