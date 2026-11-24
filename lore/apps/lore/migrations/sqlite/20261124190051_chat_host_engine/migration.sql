CREATE TABLE `chat_lore_engines` (
	`id` text PRIMARY KEY,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`project_id` integer NOT NULL,
	`engine` text DEFAULT 'api' NOT NULL,
	`engine_host` text,
	`engine_agent` text,
	`engine_model` text,
	CONSTRAINT `fk_chat_lore_engines_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `chat_agents` ADD `engine` text DEFAULT 'api' NOT NULL;--> statement-breakpoint
ALTER TABLE `chat_agents` ADD `engine_host` text;--> statement-breakpoint
ALTER TABLE `chat_agents` ADD `engine_agent` text;--> statement-breakpoint
ALTER TABLE `chat_agents` ADD `engine_model` text;--> statement-breakpoint
ALTER TABLE `chat_room_members` ADD `host_sessions` text;--> statement-breakpoint
CREATE UNIQUE INDEX `chat_lore_engines_project_id_idx` ON `chat_lore_engines` (`project_id`);