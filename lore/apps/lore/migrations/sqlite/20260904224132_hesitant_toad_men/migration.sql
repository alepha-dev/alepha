CREATE TABLE `estate_commands` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`estate_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`payload` text NOT NULL,
	`requested_by` text,
	`timeout_seconds` integer NOT NULL,
	`sent_at` text,
	`running_at` text,
	`finished_at` text,
	`step` text,
	`reason` text,
	CONSTRAINT `fk_estate_commands_estate_id_estates_id_fk` FOREIGN KEY (`estate_id`) REFERENCES `estates`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_estate_commands_requested_by_users_id_fk` FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `estate_commands_estate_id_status_idx` ON `estate_commands` (`estate_id`,`status`);--> statement-breakpoint
CREATE INDEX `estate_commands_estate_id_created_at_idx` ON `estate_commands` (`estate_id`,`created_at`);