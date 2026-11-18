CREATE TABLE `batch_guards` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	CONSTRAINT "batch_guards_valid_id" CHECK(id IS NOT NULL)
);
