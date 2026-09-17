DROP INDEX IF EXISTS `commerce_addresses_organization_id_user_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `commerce_addresses_organization_id_country_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `commerce_carts_organization_id_user_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `commerce_checkout_sessions_organization_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `commerce_checkout_sessions_organization_id_status_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `commerce_invoices_organization_id_number_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `commerce_invoices_organization_id_year_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `commerce_orders_organization_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `commerce_orders_organization_id_status_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `commerce_orders_organization_id_user_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `commerce_orders_organization_id_created_at_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `commerce_products_organization_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `commerce_products_organization_id_slug_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `commerce_products_organization_id_kind_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `commerce_products_organization_id_published_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `commerce_shipping_rates_organization_id_code_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `commerce_shipping_zones_organization_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `commerce_shipping_zones_organization_id_priority_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `commerce_stock_movements_organization_id_product_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `commerce_stock_reservations_organization_id_product_id_status_idx`;--> statement-breakpoint
CREATE INDEX `commerce_addresses_user_id_idx` ON `commerce_addresses` (`user_id`);--> statement-breakpoint
CREATE INDEX `commerce_addresses_country_idx` ON `commerce_addresses` (`country`);--> statement-breakpoint
CREATE INDEX `commerce_carts_user_id_idx` ON `commerce_carts` (`user_id`);--> statement-breakpoint
CREATE INDEX `commerce_checkout_sessions_status_idx` ON `commerce_checkout_sessions` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `commerce_invoices_number_idx` ON `commerce_invoices` (`number`);--> statement-breakpoint
CREATE INDEX `commerce_invoices_year_idx` ON `commerce_invoices` (`year`);--> statement-breakpoint
CREATE INDEX `commerce_orders_status_idx` ON `commerce_orders` (`status`);--> statement-breakpoint
CREATE INDEX `commerce_orders_user_id_idx` ON `commerce_orders` (`user_id`);--> statement-breakpoint
CREATE INDEX `commerce_orders_created_at_idx` ON `commerce_orders` (`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `commerce_products_slug_idx` ON `commerce_products` (`slug`);--> statement-breakpoint
CREATE INDEX `commerce_products_kind_idx` ON `commerce_products` (`kind`);--> statement-breakpoint
CREATE INDEX `commerce_products_published_idx` ON `commerce_products` (`published`);--> statement-breakpoint
CREATE UNIQUE INDEX `commerce_shipping_rates_code_idx` ON `commerce_shipping_rates` (`code`);--> statement-breakpoint
CREATE INDEX `commerce_shipping_zones_priority_idx` ON `commerce_shipping_zones` (`priority`);--> statement-breakpoint
CREATE INDEX `commerce_stock_movements_product_id_idx` ON `commerce_stock_movements` (`product_id`);--> statement-breakpoint
CREATE INDEX `commerce_stock_reservations_product_id_status_idx` ON `commerce_stock_reservations` (`product_id`,`status`);--> statement-breakpoint
ALTER TABLE `commerce_addresses` DROP COLUMN `organization_id`;--> statement-breakpoint
ALTER TABLE `commerce_carts` DROP COLUMN `organization_id`;--> statement-breakpoint
ALTER TABLE `commerce_checkout_sessions` DROP COLUMN `organization_id`;--> statement-breakpoint
ALTER TABLE `commerce_invoices` DROP COLUMN `organization_id`;--> statement-breakpoint
ALTER TABLE `commerce_orders` DROP COLUMN `organization_id`;--> statement-breakpoint
ALTER TABLE `commerce_products` DROP COLUMN `organization_id`;--> statement-breakpoint
ALTER TABLE `commerce_shipping_rates` DROP COLUMN `organization_id`;--> statement-breakpoint
ALTER TABLE `commerce_shipping_zones` DROP COLUMN `organization_id`;--> statement-breakpoint
ALTER TABLE `commerce_stock_movements` DROP COLUMN `organization_id`;--> statement-breakpoint
ALTER TABLE `commerce_stock_reservations` DROP COLUMN `organization_id`;