CREATE TABLE `commerce_product_prices` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`product_id` text NOT NULL,
	`variant_key` text DEFAULT '' NOT NULL,
	`currency` text NOT NULL,
	`price` integer NOT NULL,
	CONSTRAINT `fk_commerce_product_prices_product_id_commerce_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `commerce_products`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `commerce_carts` ADD `currency` text;--> statement-breakpoint
ALTER TABLE `commerce_invoices` ADD `books_vat` text;--> statement-breakpoint
ALTER TABLE `commerce_promotions` ADD `currency` text;--> statement-breakpoint
ALTER TABLE `commerce_shipping_rates` ADD `currency` text;--> statement-breakpoint
CREATE UNIQUE INDEX `commerce_product_prices_product_id_variant_key_currency_idx` ON `commerce_product_prices` (`product_id`,`variant_key`,`currency`);--> statement-breakpoint
CREATE INDEX `commerce_product_prices_currency_idx` ON `commerce_product_prices` (`currency`);--> statement-breakpoint
CREATE INDEX `commerce_product_prices_variant_key_idx` ON `commerce_product_prices` (`variant_key`);