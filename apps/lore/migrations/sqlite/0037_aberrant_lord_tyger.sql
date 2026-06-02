CREATE TABLE `sigil_vitals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sigil_id` text NOT NULL,
	`date` text NOT NULL,
	`path` text NOT NULL,
	`metric` text NOT NULL,
	`bucket` integer NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`sigil_id`) REFERENCES `sigils`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sigil_vitals_sigil_id_date_path_metric_bucket_idx` ON `sigil_vitals` (`sigil_id`,`date`,`path`,`metric`,`bucket`);--> statement-breakpoint
CREATE INDEX `sigil_vitals_sigil_id_date_metric_idx` ON `sigil_vitals` (`sigil_id`,`date`,`metric`);