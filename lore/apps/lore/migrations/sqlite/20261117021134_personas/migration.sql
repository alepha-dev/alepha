CREATE TABLE `personas` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`deleted_at` integer,
	`project_id` integer NOT NULL,
	`number` integer NOT NULL,
	`kind` text DEFAULT 'human' NOT NULL,
	`name` text NOT NULL,
	`role` text,
	`who` text DEFAULT '' NOT NULL,
	`goals` text DEFAULT '' NOT NULL,
	`frustrations` text DEFAULT '' NOT NULL,
	`alepha_role` text,
	`demo_account` text,
	`demo_seed` text,
	`environment_app` text,
	`environment_env` text,
	`areas` text DEFAULT '[]' NOT NULL,
	CONSTRAINT `fk_personas_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `requirements_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`project_id` integer NOT NULL,
	`subject_kind` text NOT NULL,
	`subject_id` integer NOT NULL,
	`author_id` text,
	`body` text NOT NULL,
	`agent_client` text,
	`by_agent` integer,
	CONSTRAINT `fk_requirements_comments_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_requirements_comments_author_id_users_id_fk` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `personas_project_id_number_idx` ON `personas` (`project_id`,`number`);--> statement-breakpoint
CREATE INDEX `requirements_comments_subject_kind_subject_id_created_at_idx` ON `requirements_comments` (`subject_kind`,`subject_id`,`created_at`);