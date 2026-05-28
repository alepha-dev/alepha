CREATE TABLE `sigil_unique_visitors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sigil_id` text NOT NULL,
	`date` text NOT NULL,
	`session_hash` text NOT NULL,
	FOREIGN KEY (`sigil_id`) REFERENCES `sigils`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sigil_unique_visitors_sigil_id_date_session_hash_idx` ON `sigil_unique_visitors` (`sigil_id`,`date`,`session_hash`);--> statement-breakpoint
CREATE INDEX `sigil_unique_visitors_sigil_id_date_idx` ON `sigil_unique_visitors` (`sigil_id`,`date`);--> statement-breakpoint
CREATE TABLE `sigil_views` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sigil_id` text NOT NULL,
	`date` text NOT NULL,
	`country` text NOT NULL,
	`path` text NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`sigil_id`) REFERENCES `sigils`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sigil_views_sigil_id_date_country_path_idx` ON `sigil_views` (`sigil_id`,`date`,`country`,`path`);--> statement-breakpoint
CREATE INDEX `sigil_views_sigil_id_date_idx` ON `sigil_views` (`sigil_id`,`date`);