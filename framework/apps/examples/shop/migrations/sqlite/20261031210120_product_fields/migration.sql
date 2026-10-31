ALTER TABLE `commerce_product_variants` ADD `compare_at_price` integer;--> statement-breakpoint
ALTER TABLE `commerce_products` ADD `compare_at_price` integer;--> statement-breakpoint
ALTER TABLE `commerce_products` ADD `meta_title` text;--> statement-breakpoint
ALTER TABLE `commerce_products` ADD `meta_description` text;--> statement-breakpoint
ALTER TABLE `commerce_products` ADD `weight_grams` integer;--> statement-breakpoint
ALTER TABLE `commerce_products` ADD `length_mm` integer;--> statement-breakpoint
ALTER TABLE `commerce_products` ADD `width_mm` integer;--> statement-breakpoint
ALTER TABLE `commerce_products` ADD `height_mm` integer;--> statement-breakpoint
ALTER TABLE `commerce_shipping_rates` ADD `min_weight_grams` integer;--> statement-breakpoint
ALTER TABLE `commerce_shipping_rates` ADD `max_weight_grams` integer;