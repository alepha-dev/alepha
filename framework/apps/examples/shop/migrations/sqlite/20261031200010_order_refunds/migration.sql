CREATE TABLE `commerce_order_refunds` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`order_id` text NOT NULL,
	`amount` integer NOT NULL,
	`reason` text,
	`lines` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`credit_note_id` text
);
--> statement-breakpoint
ALTER TABLE `commerce_order_items` ADD `refunded_quantity` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `commerce_order_refunds_order_id_idx` ON `commerce_order_refunds` (`order_id`);--> statement-breakpoint
CREATE INDEX `commerce_order_refunds_status_idx` ON `commerce_order_refunds` (`status`);