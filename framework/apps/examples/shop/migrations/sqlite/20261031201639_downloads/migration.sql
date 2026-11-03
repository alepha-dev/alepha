CREATE TABLE `commerce_downloads` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`order_id` text NOT NULL,
	`order_item_id` text NOT NULL,
	`file_id` text NOT NULL,
	`name` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`max_count` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `commerce_downloads_token_idx` ON `commerce_downloads` (`token`);--> statement-breakpoint
CREATE UNIQUE INDEX `commerce_downloads_order_item_id_idx` ON `commerce_downloads` (`order_item_id`);--> statement-breakpoint
CREATE INDEX `commerce_downloads_order_id_idx` ON `commerce_downloads` (`order_id`);