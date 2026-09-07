CREATE TABLE `rank_definitions` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`organization_id` text,
	`type` text NOT NULL,
	`scope_id` text NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`builtin` integer DEFAULT false NOT NULL,
	`permissions` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rank_definitions_type_scope_id_key_idx` ON `rank_definitions` (`type`,`scope_id`,`key`);--> statement-breakpoint
CREATE INDEX `rank_definitions_type_scope_id_idx` ON `rank_definitions` (`type`,`scope_id`);