CREATE TABLE `commerce_recovery_opt_outs` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`email` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `commerce_checkout_sessions` ADD `recovery_consent_at` text;--> statement-breakpoint
ALTER TABLE `commerce_checkout_sessions` ADD `recovery_token` text;--> statement-breakpoint
CREATE UNIQUE INDEX `commerce_recovery_opt_outs_email_idx` ON `commerce_recovery_opt_outs` (`email`);