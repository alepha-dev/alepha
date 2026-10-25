ALTER TABLE `commerce_cart_items` ADD `line_config` text;--> statement-breakpoint
ALTER TABLE `commerce_cart_items` ADD `line_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `commerce_order_items` ADD `line_config` text;--> statement-breakpoint
DROP INDEX IF EXISTS `commerce_cart_items_cart_id_product_id_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `commerce_cart_items_cart_id_product_id_line_key_idx` ON `commerce_cart_items` (`cart_id`,`product_id`,`line_key`);