CREATE TABLE `stack_environment_routes` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`environment_id` text NOT NULL,
	`service` text NOT NULL,
	`domain` text NOT NULL,
	CONSTRAINT `fk_stack_environment_routes_environment_id_stack_environments_id_fk` FOREIGN KEY (`environment_id`) REFERENCES `stack_environments`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `stack_environments` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`stack_id` text NOT NULL,
	`env` text NOT NULL,
	`estate_id` text,
	`base_domain` text,
	`revision` integer,
	CONSTRAINT `fk_stack_environments_stack_id_stacks_id_fk` FOREIGN KEY (`stack_id`) REFERENCES `stacks`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_stack_environments_estate_id_estates_id_fk` FOREIGN KEY (`estate_id`) REFERENCES `estates`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `stack_revisions` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`stack_id` text NOT NULL,
	`number` integer NOT NULL,
	`file_id` text NOT NULL,
	`sha256` text NOT NULL,
	`size` integer NOT NULL,
	`model` text NOT NULL,
	`compose` text NOT NULL,
	`digests` text,
	`created_by` text,
	CONSTRAINT `fk_stack_revisions_stack_id_stacks_id_fk` FOREIGN KEY (`stack_id`) REFERENCES `stacks`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_stack_revisions_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `stacks` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`project_id` integer NOT NULL,
	`name` text NOT NULL,
	`estate_id` text,
	`created_by` text,
	CONSTRAINT `fk_stacks_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_stacks_estate_id_estates_id_fk` FOREIGN KEY (`estate_id`) REFERENCES `estates`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_stacks_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
ALTER TABLE `app_instances` ADD `stack_environment_id` text REFERENCES stack_environments(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `app_instances_stack_environment_id_idx` ON `app_instances` (`stack_environment_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `stack_environment_routes_environment_id_domain_idx` ON `stack_environment_routes` (`environment_id`,`domain`);--> statement-breakpoint
CREATE UNIQUE INDEX `stack_environments_stack_id_env_idx` ON `stack_environments` (`stack_id`,`env`);--> statement-breakpoint
CREATE INDEX `stack_environments_estate_id_idx` ON `stack_environments` (`estate_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `stack_revisions_stack_id_number_idx` ON `stack_revisions` (`stack_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `stacks_project_id_name_idx` ON `stacks` (`project_id`,`name`);--> statement-breakpoint
CREATE INDEX `stacks_estate_id_idx` ON `stacks` (`estate_id`);