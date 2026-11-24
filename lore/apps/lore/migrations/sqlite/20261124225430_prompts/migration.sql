CREATE TABLE `prompts` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`project_id` integer NOT NULL,
	`name` text NOT NULL,
	`builtin` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_by` text,
	`title` text,
	`description` text,
	`text` text,
	`args` text,
	`source` text,
	`ref` text,
	`host` text,
	`agent` text,
	`model` text,
	CONSTRAINT `fk_prompts_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_prompts_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prompts_project_id_name_idx` ON `prompts` (`project_id`,`name`);--> statement-breakpoint
-- Prompts (#E174, #Q4274): `automation:manage` becomes `prompt:manage`, and
-- `automation:*` `prompt:*`, in ranks and API keys (JSON text arrays).
UPDATE `organization_ranks` SET `permissions` = (SELECT json_group_array(CASE value WHEN 'automation:manage' THEN 'prompt:manage' WHEN 'automation:*' THEN 'prompt:*' ELSE value END) FROM json_each(`permissions`))
WHERE EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE value IN ('automation:manage', 'automation:*'));--> statement-breakpoint
UPDATE `api_keys` SET `permissions` = (SELECT json_group_array(CASE value WHEN 'automation:manage' THEN 'prompt:manage' WHEN 'automation:*' THEN 'prompt:*' ELSE value END) FROM json_each(`permissions`))
WHERE EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE value IN ('automation:manage', 'automation:*'));
