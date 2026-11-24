ALTER TABLE `agent_automations` ADD `schedule` text;--> statement-breakpoint
ALTER TABLE `agent_automations` ADD `daily_hour` integer;--> statement-breakpoint
ALTER TABLE `agent_automations` ADD `next_run_at` text;--> statement-breakpoint
ALTER TABLE `agent_automations` ADD `last_skipped_at` text;--> statement-breakpoint
ALTER TABLE `agent_automations` ADD `last_skipped_reason` text;--> statement-breakpoint
CREATE INDEX `agent_automations_next_run_at_idx` ON `agent_automations` (`next_run_at`);