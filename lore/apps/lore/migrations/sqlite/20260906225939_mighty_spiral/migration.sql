CREATE TABLE `estate_inventories` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`estate_id` text NOT NULL,
	`at` text NOT NULL,
	`reported_at` text NOT NULL,
	`bay_version` text,
	`host` text NOT NULL,
	`apps` text NOT NULL,
	`app_count` integer NOT NULL,
	CONSTRAINT `fk_estate_inventories_estate_id_estates_id_fk` FOREIGN KEY (`estate_id`) REFERENCES `estates`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `estate_commands` ADD `result_file_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `estate_inventories_estate_id_idx` ON `estate_inventories` (`estate_id`);