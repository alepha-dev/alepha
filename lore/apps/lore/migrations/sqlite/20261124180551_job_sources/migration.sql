ALTER TABLE `agent_automations` ADD `source` text;--> statement-breakpoint
ALTER TABLE `agent_automations` ADD `ref` text;--> statement-breakpoint
ALTER TABLE `host_jobs` ADD `commit` text;--> statement-breakpoint
ALTER TABLE `host_jobs` ADD `warning` text;--> statement-breakpoint
ALTER TABLE `hosts` ADD `jobs_sources` integer;