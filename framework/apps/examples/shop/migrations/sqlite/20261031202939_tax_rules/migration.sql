ALTER TABLE `commerce_checkout_sessions` ADD `vat_number` text;--> statement-breakpoint
ALTER TABLE `commerce_orders` ADD `tax_country` text;--> statement-breakpoint
ALTER TABLE `commerce_orders` ADD `shipping_rate_bps` integer;--> statement-breakpoint
ALTER TABLE `commerce_orders` ADD `vat_number` text;