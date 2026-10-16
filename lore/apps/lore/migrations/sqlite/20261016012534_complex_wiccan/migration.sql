CREATE TABLE `automation_adoptions` (
	`id` text PRIMARY KEY,
	`project_id` integer NOT NULL,
	`policy` text NOT NULL,
	`automation_id` text NOT NULL,
	`author_user_id` text NOT NULL,
	`state` text NOT NULL,
	`adopted_at` integer,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	CONSTRAINT `fk_automation_adoptions_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_automation_adoptions_automation_id_automations_id_fk` FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_automation_adoptions_author_user_id_users_id_fk` FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX `automation_adoptions_project_id_policy_idx` ON `automation_adoptions` (`project_id`,`policy`);--> statement-breakpoint
CREATE INDEX `automation_adoptions_automation_id_idx` ON `automation_adoptions` (`automation_id`);