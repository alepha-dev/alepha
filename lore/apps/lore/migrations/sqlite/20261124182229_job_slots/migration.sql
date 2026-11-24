ALTER TABLE `host_jobs` ADD `busy_at` text;--> statement-breakpoint
ALTER TABLE `hosts` ADD `jobs_max_jobs` integer;--> statement-breakpoint
ALTER TABLE `hosts` ADD `jobs_running` integer;