ALTER TABLE `payment_intents` ADD `save_card` integer;--> statement-breakpoint
ALTER TABLE `payment_methods` ADD `provider_account` text;--> statement-breakpoint
CREATE UNIQUE INDEX `payment_methods_provider_account_provider_ref_idx` ON `payment_methods` (`provider_account`,`provider_ref`);