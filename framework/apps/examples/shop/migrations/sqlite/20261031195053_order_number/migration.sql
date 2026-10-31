ALTER TABLE `commerce_orders` ADD `number` text;--> statement-breakpoint
CREATE UNIQUE INDEX `commerce_orders_number_idx` ON `commerce_orders` (`number`);