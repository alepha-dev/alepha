CREATE TABLE `agent_automations` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`project_id` integer NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_by` text,
	`prompt_kind` text NOT NULL,
	`prompt_text` text,
	`host` text,
	`agent` text,
	`model` text,
	`trigger` text DEFAULT 'manual' NOT NULL,
	`only_if_work` integer DEFAULT false NOT NULL,
	`last_job_id` text,
	`last_run_at` text,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `fk_agent_automations_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_agent_automations_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
ALTER TABLE `host_jobs` ADD `automation_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `agent_automations_project_id_name_idx` ON `agent_automations` (`project_id`,`name`);--> statement-breakpoint
CREATE INDEX `host_jobs_automation_id_status_idx` ON `host_jobs` (`automation_id`,`status`);--> statement-breakpoint
-- Agent automations (#Q4226): an Admin rank stored after the snapshot
-- cutoff (#Q3920) holds every permission of its day, so it gains
-- `automation:manage` as the default Admin does. One that dropped
-- `host:update` was narrowed on purpose and is left alone.
UPDATE `organization_ranks` SET `permissions` = json_insert(`permissions`, '$[#]', 'automation:manage')
WHERE `key` = 'admin'
  AND EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE value = 'host:update')
  AND NOT EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE value = 'automation:manage');
