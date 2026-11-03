CREATE TABLE `commerce_promotion_redemptions` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`promotion_id` text NOT NULL,
	`order_id` text NOT NULL,
	`user_id` text,
	`email` text,
	CONSTRAINT `fk_commerce_promotion_redemptions_promotion_id_commerce_promotions_id_fk` FOREIGN KEY (`promotion_id`) REFERENCES `commerce_promotions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `commerce_promotions` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`name` text NOT NULL,
	`code` text,
	`kind` text NOT NULL,
	`value` integer DEFAULT 0 NOT NULL,
	`min_subtotal` integer,
	`starts_at` text,
	`ends_at` text,
	`usage_limit` integer,
	`usage_per_customer` integer,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE `commerce_carts` ADD `promotion_code` text;--> statement-breakpoint
ALTER TABLE `commerce_checkout_sessions` ADD `discount_total` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `commerce_order_items` ADD `discount` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `commerce_orders` ADD `discount_total` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `commerce_orders` ADD `promotion_code` text;--> statement-breakpoint
CREATE UNIQUE INDEX `commerce_promotion_redemptions_promotion_id_order_id_idx` ON `commerce_promotion_redemptions` (`promotion_id`,`order_id`);--> statement-breakpoint
CREATE INDEX `commerce_promotion_redemptions_order_id_idx` ON `commerce_promotion_redemptions` (`order_id`);--> statement-breakpoint
CREATE INDEX `commerce_promotion_redemptions_user_id_idx` ON `commerce_promotion_redemptions` (`user_id`);--> statement-breakpoint
CREATE INDEX `commerce_promotion_redemptions_email_idx` ON `commerce_promotion_redemptions` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `commerce_promotions_code_idx` ON `commerce_promotions` (`code`);--> statement-breakpoint
CREATE INDEX `commerce_promotions_active_idx` ON `commerce_promotions` (`active`);