CREATE TABLE `commerce_categories` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`parent_id` text,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`position` integer DEFAULT 0 NOT NULL,
	`published` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE `commerce_products` ADD `tracks_stock` integer DEFAULT true NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `commerce_categories_slug_idx` ON `commerce_categories` (`slug`);--> statement-breakpoint
CREATE INDEX `commerce_categories_parent_id_idx` ON `commerce_categories` (`parent_id`);--> statement-breakpoint
CREATE INDEX `commerce_products_category_id_idx` ON `commerce_products` (`category_id`);--> statement-breakpoint
UPDATE `commerce_products` SET `tracks_stock` = false WHERE `kind` = 'digital';
