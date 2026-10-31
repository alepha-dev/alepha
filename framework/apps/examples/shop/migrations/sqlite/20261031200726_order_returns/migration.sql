CREATE TABLE `commerce_order_returns` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`order_id` text NOT NULL,
	`status` text DEFAULT 'requested' NOT NULL,
	`lines` text NOT NULL,
	`reason` text,
	`note` text,
	`received_at` text,
	`refund_id` text
);
--> statement-breakpoint
ALTER TABLE `commerce_order_items` ADD `cancelled_quantity` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `commerce_order_returns_order_id_idx` ON `commerce_order_returns` (`order_id`);--> statement-breakpoint
CREATE INDEX `commerce_order_returns_status_idx` ON `commerce_order_returns` (`status`);