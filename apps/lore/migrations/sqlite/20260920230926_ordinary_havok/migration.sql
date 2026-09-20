CREATE TABLE `analytics_backfills` (
	`dataset` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`window_from` text NOT NULL,
	`window_to` text NOT NULL,
	`points` integer NOT NULL,
	`events` integer NOT NULL,
	`skipped_hours` integer NOT NULL
);
