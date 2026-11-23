-- Chat agents (#E170, #Q4196): `chat:agent` reaches the stored ranks and
-- API keys that hold `chat:manage` (the Admin), as `chat_permissions` did for
-- the first three: stored rows are never reseeded. `chat:*` already covers it.
CREATE TABLE `chat_agents` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`project_id` integer NOT NULL,
	`handle` text,
	`name` text NOT NULL,
	`avatar` text,
	`pre_prompt` text NOT NULL,
	`model` text,
	`created_by` text,
	`deleted_at` integer,
	CONSTRAINT `fk_chat_agents_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_chat_agents_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
ALTER TABLE `chat_mentions` ADD `agent_id` text;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `agent_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `chat_agents_project_id_handle_idx` ON `chat_agents` (`project_id`,`handle`);--> statement-breakpoint
UPDATE `organization_ranks` SET `permissions` = json_insert(`permissions`, '$[#]', 'chat:agent')
WHERE (EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE value = 'chat:manage'))
  AND NOT EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE value = 'chat:agent');--> statement-breakpoint
UPDATE `api_keys` SET `permissions` = json_insert(`permissions`, '$[#]', 'chat:agent')
WHERE (EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE value = 'chat:manage'))
  AND NOT EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE value = 'chat:agent');
