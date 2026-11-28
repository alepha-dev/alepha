CREATE TABLE `github_apps` (
	`id` text PRIMARY KEY,
	`app_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`html_url` text NOT NULL,
	`owner_login` text,
	`client_id` text NOT NULL,
	`client_secret` text NOT NULL,
	`private_key` text NOT NULL,
	`webhook_secret` text NOT NULL,
	`credential_key_version` integer NOT NULL,
	`webhook_ping_at` text,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	CONSTRAINT `fk_github_apps_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `github_states` (
	`id` text PRIMARY KEY,
	`purpose` text NOT NULL,
	`user_id` text NOT NULL,
	`project_id` integer,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	CONSTRAINT `fk_github_states_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_github_states_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `github_states_expires_at_idx` ON `github_states` (`expires_at`);