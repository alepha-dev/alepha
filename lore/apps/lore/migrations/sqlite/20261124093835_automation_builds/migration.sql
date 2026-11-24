ALTER TABLE `agent_automations` ADD `auto_merge` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_automations` ADD `concurrency` integer DEFAULT 1 NOT NULL;