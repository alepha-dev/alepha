CREATE TABLE `app_secrets` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`instance_id` text NOT NULL,
	`key` text NOT NULL,
	`value_sealed` text NOT NULL,
	`value_prefix` text DEFAULT '' NOT NULL,
	`key_version` integer DEFAULT 1 NOT NULL,
	`updated_by` text,
	CONSTRAINT `fk_app_secrets_instance_id_app_instances_id_fk` FOREIGN KEY (`instance_id`) REFERENCES `app_instances`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_secrets_instance_id_key_idx` ON `app_secrets` (`instance_id`,`key`);