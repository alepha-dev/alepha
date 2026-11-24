ALTER TABLE `agent_automations` ADD `event_keys` text;--> statement-breakpoint
ALTER TABLE `agent_automations` ADD `settle_seconds` integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_automations` ADD `pending` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_automations` ADD `pending_job_id` text;--> statement-breakpoint
ALTER TABLE `project_events` ADD `job_id` text;