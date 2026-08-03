CREATE TABLE `alepha_sequences` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`name` text NOT NULL,
	`scope` text DEFAULT 'default' NOT NULL,
	`value` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cache_entries` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`container` text NOT NULL,
	`cache_key` text NOT NULL,
	`value` text,
	`count` integer,
	`expires_at` integer
);
--> statement-breakpoint
CREATE TABLE `commerce_addresses` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`organization_id` text,
	`user_id` text,
	`full_name` text NOT NULL,
	`line1` text NOT NULL,
	`line2` text,
	`locality` text NOT NULL,
	`region` text,
	`postal_code` text NOT NULL,
	`country` text NOT NULL,
	`phone` text,
	`is_default` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `commerce_cart_items` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`cart_id` text NOT NULL,
	`product_id` text NOT NULL,
	`quantity` integer NOT NULL,
	CONSTRAINT `fk_commerce_cart_items_cart_id_commerce_carts_id_fk` FOREIGN KEY (`cart_id`) REFERENCES `commerce_carts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `commerce_carts` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`organization_id` text,
	`token` text NOT NULL,
	`user_id` text,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `commerce_checkout_sessions` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`organization_id` text,
	`cart_id` text NOT NULL,
	`user_id` text,
	`status` text DEFAULT 'open' NOT NULL,
	`email` text,
	`shipping_address` text,
	`shipping_method` text,
	`subtotal` integer DEFAULT 0 NOT NULL,
	`shipping_total` integer DEFAULT 0 NOT NULL,
	`tax_total` integer DEFAULT 0 NOT NULL,
	`grand_total` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`order_id` text,
	`payment_intent_id` text
);
--> statement-breakpoint
CREATE TABLE `commerce_invoices` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`organization_id` text,
	`number` text NOT NULL,
	`year` integer NOT NULL,
	`order_id` text NOT NULL,
	`credits_invoice_id` text,
	`note` text,
	`issued_at` text NOT NULL,
	`seller` text NOT NULL,
	`buyer` text NOT NULL,
	`lines` text NOT NULL,
	`vat_buckets` text NOT NULL,
	`base_total` integer NOT NULL,
	`vat_total` integer NOT NULL,
	`grand_total` integer NOT NULL,
	`currency` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `commerce_order_items` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`order_id` text NOT NULL,
	`product_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`unit_price` integer NOT NULL,
	`quantity` integer NOT NULL,
	`config` text,
	CONSTRAINT `fk_commerce_order_items_order_id_commerce_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `commerce_orders`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `commerce_orders` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`organization_id` text,
	`user_id` text,
	`status` text NOT NULL,
	`total` integer NOT NULL,
	`shipping_total` integer DEFAULT 0 NOT NULL,
	`tax_total` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`payment_intent_id` text,
	`shipping_method` text,
	`tracking_number` text,
	`tracking_url` text,
	`shipped_at` text,
	`delivered_at` text,
	`shipping_address` text,
	`notes` text
);
--> statement-breakpoint
CREATE TABLE `commerce_products` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`organization_id` text,
	`kind` text DEFAULT 'good' NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`price` integer NOT NULL,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`category_id` text,
	`images` text DEFAULT '[]' NOT NULL,
	`config` text,
	`attributes` text,
	`published` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `commerce_shipping_rates` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`organization_id` text,
	`zone_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`price` integer NOT NULL,
	`free_above` integer,
	`min_days` integer,
	`max_days` integer,
	`active` integer DEFAULT true NOT NULL,
	CONSTRAINT `fk_commerce_shipping_rates_zone_id_commerce_shipping_zones_id_fk` FOREIGN KEY (`zone_id`) REFERENCES `commerce_shipping_zones`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `commerce_shipping_zones` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`organization_id` text,
	`name` text NOT NULL,
	`countries` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `commerce_stock_movements` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`organization_id` text,
	`product_id` text NOT NULL,
	`delta` integer NOT NULL,
	`reason` text NOT NULL,
	`order_id` text,
	`note` text
);
--> statement-breakpoint
CREATE TABLE `commerce_stock_reservations` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`organization_id` text,
	`product_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`order_id` text NOT NULL,
	`status` text DEFAULT 'held' NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`organization_id` text,
	`blob_id` text NOT NULL,
	`creator` text,
	`creator_realm` text,
	`creator_name` text,
	`bucket` text NOT NULL,
	`expiration_date` integer,
	`name` text NOT NULL,
	`original_name` text,
	`size` real NOT NULL,
	`mime_type` text NOT NULL,
	`tags` text,
	`checksum` text
);
--> statement-breakpoint
CREATE TABLE `identities` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`user_id` text NOT NULL,
	`password` text,
	`provider` text NOT NULL,
	`provider_user_id` text,
	`provider_data` text,
	CONSTRAINT `fk_identities_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `job_executions` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`job_name` text NOT NULL,
	`key` text,
	`organization_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`priority` integer DEFAULT 2 NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 1 NOT NULL,
	`payload` text,
	`scheduled_at` integer,
	`started_at` integer,
	`completed_at` integer,
	`error` text,
	`logs` text,
	`triggered_by` text,
	`triggered_by_name` text,
	`cancelled_by` text,
	`cancelled_by_name` text
);
--> statement-breakpoint
CREATE TABLE `payment_intents` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`organization_id` text,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`status` text NOT NULL,
	`provider_ref` text,
	`provider_raw` text,
	`metadata` text,
	`payment_method_id` text,
	`user_id` text
);
--> statement-breakpoint
CREATE TABLE `payment_methods` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`organization_id` text,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`brand` text,
	`last4` text,
	`exp_month` integer,
	`exp_year` integer,
	`is_default` integer NOT NULL,
	`provider_ref` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `refunds` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`organization_id` text,
	`intent_id` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	`provider_ref` text
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`refresh_token` text NOT NULL,
	`user_id` text NOT NULL,
	`client_id` text,
	`expires_at` integer NOT NULL,
	`last_used_at` integer,
	`ip` text,
	`country` text,
	`user_agent` text,
	CONSTRAINT `fk_sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`realm` text DEFAULT 'default' NOT NULL,
	`username` text,
	`email` text,
	`phone_number` text,
	`roles` text DEFAULT '[]' NOT NULL,
	`first_name` text,
	`last_name` text,
	`picture` text,
	`enabled` integer DEFAULT true NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`last_login_at` integer,
	`organization_id` text
);
--> statement-breakpoint
CREATE TABLE `verification` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`type` text NOT NULL,
	`target` text NOT NULL,
	`purpose` text DEFAULT 'default' NOT NULL,
	`code` text NOT NULL,
	`verified_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `alepha_sequences_name_scope_idx` ON `alepha_sequences` (`name`,`scope`);--> statement-breakpoint
CREATE UNIQUE INDEX `cache_entries_container_cache_key_idx` ON `cache_entries` (`container`,`cache_key`);--> statement-breakpoint
CREATE INDEX `cache_entries_expires_at_idx` ON `cache_entries` (`expires_at`);--> statement-breakpoint
CREATE INDEX `commerce_addresses_organization_id_user_id_idx` ON `commerce_addresses` (`organization_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `commerce_addresses_organization_id_country_idx` ON `commerce_addresses` (`organization_id`,`country`);--> statement-breakpoint
CREATE INDEX `commerce_cart_items_cart_id_idx` ON `commerce_cart_items` (`cart_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `commerce_cart_items_cart_id_product_id_idx` ON `commerce_cart_items` (`cart_id`,`product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `commerce_carts_token_idx` ON `commerce_carts` (`token`);--> statement-breakpoint
CREATE INDEX `commerce_carts_organization_id_user_id_idx` ON `commerce_carts` (`organization_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `commerce_carts_expires_at_idx` ON `commerce_carts` (`expires_at`);--> statement-breakpoint
CREATE INDEX `commerce_checkout_sessions_organization_id_idx` ON `commerce_checkout_sessions` (`organization_id`);--> statement-breakpoint
CREATE INDEX `commerce_checkout_sessions_cart_id_idx` ON `commerce_checkout_sessions` (`cart_id`);--> statement-breakpoint
CREATE INDEX `commerce_checkout_sessions_organization_id_status_idx` ON `commerce_checkout_sessions` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX `commerce_checkout_sessions_order_id_idx` ON `commerce_checkout_sessions` (`order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `commerce_invoices_organization_id_number_idx` ON `commerce_invoices` (`organization_id`,`number`);--> statement-breakpoint
CREATE INDEX `commerce_invoices_order_id_idx` ON `commerce_invoices` (`order_id`);--> statement-breakpoint
CREATE INDEX `commerce_invoices_organization_id_year_idx` ON `commerce_invoices` (`organization_id`,`year`);--> statement-breakpoint
CREATE INDEX `commerce_order_items_order_id_idx` ON `commerce_order_items` (`order_id`);--> statement-breakpoint
CREATE INDEX `commerce_order_items_product_id_idx` ON `commerce_order_items` (`product_id`);--> statement-breakpoint
CREATE INDEX `commerce_orders_organization_id_idx` ON `commerce_orders` (`organization_id`);--> statement-breakpoint
CREATE INDEX `commerce_orders_organization_id_status_idx` ON `commerce_orders` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX `commerce_orders_organization_id_user_id_idx` ON `commerce_orders` (`organization_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `commerce_orders_organization_id_created_at_idx` ON `commerce_orders` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `commerce_products_organization_id_idx` ON `commerce_products` (`organization_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `commerce_products_organization_id_slug_idx` ON `commerce_products` (`organization_id`,`slug`);--> statement-breakpoint
CREATE INDEX `commerce_products_organization_id_kind_idx` ON `commerce_products` (`organization_id`,`kind`);--> statement-breakpoint
CREATE INDEX `commerce_products_organization_id_published_idx` ON `commerce_products` (`organization_id`,`published`);--> statement-breakpoint
CREATE INDEX `commerce_shipping_rates_zone_id_idx` ON `commerce_shipping_rates` (`zone_id`);--> statement-breakpoint
CREATE INDEX `commerce_shipping_rates_organization_id_code_idx` ON `commerce_shipping_rates` (`organization_id`,`code`);--> statement-breakpoint
CREATE INDEX `commerce_shipping_zones_organization_id_idx` ON `commerce_shipping_zones` (`organization_id`);--> statement-breakpoint
CREATE INDEX `commerce_shipping_zones_organization_id_priority_idx` ON `commerce_shipping_zones` (`organization_id`,`priority`);--> statement-breakpoint
CREATE INDEX `commerce_stock_movements_organization_id_product_id_idx` ON `commerce_stock_movements` (`organization_id`,`product_id`);--> statement-breakpoint
CREATE INDEX `commerce_stock_movements_order_id_idx` ON `commerce_stock_movements` (`order_id`);--> statement-breakpoint
CREATE INDEX `commerce_stock_reservations_organization_id_product_id_status_idx` ON `commerce_stock_reservations` (`organization_id`,`product_id`,`status`);--> statement-breakpoint
CREATE INDEX `commerce_stock_reservations_order_id_idx` ON `commerce_stock_reservations` (`order_id`);--> statement-breakpoint
CREATE INDEX `commerce_stock_reservations_status_expires_at_idx` ON `commerce_stock_reservations` (`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `files_expiration_date_idx` ON `files` (`expiration_date`);--> statement-breakpoint
CREATE INDEX `files_bucket_idx` ON `files` (`bucket`);--> statement-breakpoint
CREATE INDEX `files_creator_idx` ON `files` (`creator`);--> statement-breakpoint
CREATE INDEX `files_created_at_idx` ON `files` (`created_at`);--> statement-breakpoint
CREATE INDEX `files_mime_type_idx` ON `files` (`mime_type`);--> statement-breakpoint
CREATE INDEX `files_bucket_created_at_idx` ON `files` (`bucket`,`created_at`);--> statement-breakpoint
CREATE INDEX `identities_user_id_idx` ON `identities` (`user_id`);--> statement-breakpoint
CREATE INDEX `identities_provider_idx` ON `identities` (`provider`);--> statement-breakpoint
CREATE INDEX `identities_user_id_provider_idx` ON `identities` (`user_id`,`provider`);--> statement-breakpoint
CREATE UNIQUE INDEX `identities_provider_provider_user_id_idx` ON `identities` (`provider`,`provider_user_id`);--> statement-breakpoint
CREATE INDEX `job_executions_job_name_status_scheduled_at_idx` ON `job_executions` (`job_name`,`status`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `job_executions_job_name_status_created_at_idx` ON `job_executions` (`job_name`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `job_executions_job_name_started_at_idx` ON `job_executions` (`job_name`,`started_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `job_executions_job_name_key_idx` ON `job_executions` (`job_name`,`key`);--> statement-breakpoint
CREATE INDEX `payment_intents_status_idx` ON `payment_intents` (`status`);--> statement-breakpoint
CREATE INDEX `payment_intents_organization_id_idx` ON `payment_intents` (`organization_id`);--> statement-breakpoint
CREATE INDEX `payment_intents_user_id_idx` ON `payment_intents` (`user_id`);--> statement-breakpoint
CREATE INDEX `payment_intents_created_at_idx` ON `payment_intents` (`created_at`);--> statement-breakpoint
CREATE INDEX `payment_methods_user_id_idx` ON `payment_methods` (`user_id`);--> statement-breakpoint
CREATE INDEX `payment_methods_organization_id_idx` ON `payment_methods` (`organization_id`);--> statement-breakpoint
CREATE INDEX `refunds_intent_id_idx` ON `refunds` (`intent_id`);--> statement-breakpoint
CREATE INDEX `refunds_organization_id_idx` ON `refunds` (`organization_id`);--> statement-breakpoint
CREATE INDEX `refunds_status_idx` ON `refunds` (`status`);--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_at_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_refresh_token_idx` ON `sessions` (`refresh_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_realm_username_lower_idx` ON `users` (`realm`,LOWER("username"));--> statement-breakpoint
CREATE UNIQUE INDEX `users_realm_email_idx` ON `users` (`realm`,`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_realm_phone_number_idx` ON `users` (`realm`,`phone_number`);--> statement-breakpoint
CREATE INDEX `verification_created_at_idx` ON `verification` (`created_at`);--> statement-breakpoint
CREATE INDEX `verification_target_code_idx` ON `verification` (`target`,`code`);