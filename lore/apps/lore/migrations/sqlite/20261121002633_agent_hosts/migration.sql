ALTER TABLE `hosts` ADD `agent_host` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `hosts` ADD `agent_status` text;--> statement-breakpoint
ALTER TABLE `hosts` ADD `agent_checked_at` text;--> statement-breakpoint
ALTER TABLE `hosts` ADD `agent_error` text;--> statement-breakpoint
ALTER TABLE `hosts` ADD `agent_cli_version` text;--> statement-breakpoint
ALTER TABLE `hosts` ADD `agent_model` text;--> statement-breakpoint
ALTER TABLE `hosts` ADD `agent_credential` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `default_agent_host_id` text;