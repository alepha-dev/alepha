CREATE TABLE `audits` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`organization_id` text,
	`type` text NOT NULL,
	`action` text NOT NULL,
	`severity` text DEFAULT 'info' NOT NULL,
	`user_id` text,
	`user_realm` text,
	`user_email` text,
	`resource_type` text,
	`resource_id` text,
	`description` text,
	`metadata` text,
	`ip_address` text,
	`user_agent` text,
	`session_id` text,
	`request_id` text,
	`success` integer DEFAULT true NOT NULL,
	`error_message` text
);
--> statement-breakpoint
CREATE TABLE `parameters` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`organization_id` text,
	`name` text NOT NULL,
	`content` text NOT NULL,
	`schema_hash` text NOT NULL,
	`activation_date` integer NOT NULL,
	`version` integer NOT NULL,
	`change_description` text,
	`tags` text,
	`creator_id` text,
	`creator_name` text,
	`previous_content` text,
	`migration_log` text
);
--> statement-breakpoint
CREATE INDEX `audits_created_at_idx` ON `audits` (`created_at`);--> statement-breakpoint
CREATE INDEX `audits_type_idx` ON `audits` (`type`);--> statement-breakpoint
CREATE INDEX `audits_action_idx` ON `audits` (`action`);--> statement-breakpoint
CREATE INDEX `audits_user_id_idx` ON `audits` (`user_id`);--> statement-breakpoint
CREATE INDEX `audits_user_realm_idx` ON `audits` (`user_realm`);--> statement-breakpoint
CREATE INDEX `audits_resource_type_idx` ON `audits` (`resource_type`);--> statement-breakpoint
CREATE INDEX `audits_resource_id_idx` ON `audits` (`resource_id`);--> statement-breakpoint
CREATE INDEX `audits_severity_idx` ON `audits` (`severity`);--> statement-breakpoint
CREATE INDEX `audits_type_action_idx` ON `audits` (`type`,`action`);--> statement-breakpoint
CREATE INDEX `audits_user_id_created_at_idx` ON `audits` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audits_user_realm_created_at_idx` ON `audits` (`user_realm`,`created_at`);--> statement-breakpoint
CREATE INDEX `parameters_organization_id_name_activation_date_idx` ON `parameters` (`organization_id`,`name`,`activation_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `parameters_organization_id_name_version_idx` ON `parameters` (`organization_id`,`name`,`version`);--> statement-breakpoint
CREATE INDEX `parameters_activation_date_idx` ON `parameters` (`activation_date`);