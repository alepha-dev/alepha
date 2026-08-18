CREATE TABLE `alepha_sequences` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`name` text NOT NULL,
	`scope` text DEFAULT 'default' NOT NULL,
	`value` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `views` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`name` text NOT NULL,
	`count` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `alepha_sequences_name_scope_idx` ON `alepha_sequences` (`name`,`scope`);--> statement-breakpoint
CREATE UNIQUE INDEX `name_idx` ON `views` (`name`);