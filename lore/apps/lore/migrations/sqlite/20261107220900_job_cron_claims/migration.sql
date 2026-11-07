CREATE TABLE `job_cron_claims` (
	`id` text PRIMARY KEY,
	`job_name` text NOT NULL,
	`instant` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
