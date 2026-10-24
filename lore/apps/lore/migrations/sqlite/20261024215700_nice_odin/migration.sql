CREATE TABLE `stack_variables` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`environment_id` text NOT NULL,
	`key` text NOT NULL,
	`value_sealed` text NOT NULL,
	`value_prefix` text DEFAULT '' NOT NULL,
	`generated` integer DEFAULT false NOT NULL,
	`key_version` integer DEFAULT 1 NOT NULL,
	`updated_by` text,
	CONSTRAINT `fk_stack_variables_environment_id_stack_environments_id_fk` FOREIGN KEY (`environment_id`) REFERENCES `stack_environments`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stack_variables_environment_id_key_idx` ON `stack_variables` (`environment_id`,`key`);