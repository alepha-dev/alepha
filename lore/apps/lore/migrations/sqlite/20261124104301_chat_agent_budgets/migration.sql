CREATE TABLE `chat_agent_budgets` (
	`id` text PRIMARY KEY,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`project_id` integer NOT NULL,
	`tokens` integer NOT NULL,
	`updated_by` text,
	CONSTRAINT `fk_chat_agent_budgets_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_chat_agent_budgets_updated_by_users_id_fk` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `chat_agent_charges` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`project_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`conversation_id` text,
	`tokens` integer NOT NULL,
	CONSTRAINT `fk_chat_agent_charges_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_agent_budgets_project_id_idx` ON `chat_agent_budgets` (`project_id`);--> statement-breakpoint
CREATE INDEX `chat_agent_charges_project_id_created_at_idx` ON `chat_agent_charges` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `chat_agent_charges_user_id_created_at_idx` ON `chat_agent_charges` (`user_id`,`created_at`);