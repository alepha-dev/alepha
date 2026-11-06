ALTER TABLE `estates` ADD `enrolment_hash` text;--> statement-breakpoint
ALTER TABLE `estates` ADD `enrolment_expires_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `estates_enrolment_hash_idx` ON `estates` (`enrolment_hash`);