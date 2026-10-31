CREATE TABLE `commerce_product_variants` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`product_id` text NOT NULL,
	`sku` text NOT NULL,
	`options` text NOT NULL,
	`price` integer,
	`image` text,
	`weight_grams` integer,
	`position` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	CONSTRAINT `fk_commerce_product_variants_product_id_commerce_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `commerce_products`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `commerce_cart_items` ADD `variant_id` text;--> statement-breakpoint
ALTER TABLE `commerce_order_items` ADD `variant_id` text;--> statement-breakpoint
ALTER TABLE `commerce_order_items` ADD `sku` text;--> statement-breakpoint
ALTER TABLE `commerce_order_items` ADD `variant_label` text;--> statement-breakpoint
ALTER TABLE `commerce_products` ADD `option_groups` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `commerce_stock_movements` ADD `variant_id` text;--> statement-breakpoint
ALTER TABLE `commerce_stock_reservations` ADD `variant_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `commerce_product_variants_sku_idx` ON `commerce_product_variants` (`sku`);--> statement-breakpoint
CREATE INDEX `commerce_product_variants_product_id_idx` ON `commerce_product_variants` (`product_id`);--> statement-breakpoint
CREATE INDEX `commerce_stock_movements_variant_id_idx` ON `commerce_stock_movements` (`variant_id`);--> statement-breakpoint
CREATE INDEX `commerce_stock_reservations_variant_id_status_idx` ON `commerce_stock_reservations` (`variant_id`,`status`);