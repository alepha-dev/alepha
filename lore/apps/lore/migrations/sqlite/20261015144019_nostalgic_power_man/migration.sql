ALTER TABLE `monitors` ADD `push_token_hash` text;--> statement-breakpoint
CREATE UNIQUE INDEX `monitors_push_token_hash_idx` ON `monitors` (`push_token_hash`);