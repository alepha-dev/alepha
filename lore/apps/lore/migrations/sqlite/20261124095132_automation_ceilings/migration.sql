ALTER TABLE `agent_automations` ADD `max_runs_per_hour` integer DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_automations` ADD `max_runs_per_day` integer DEFAULT 48 NOT NULL;--> statement-breakpoint
ALTER TABLE `project_thresholds` ADD `automation_builds_per_day` integer;--> statement-breakpoint
ALTER TABLE `projects` ADD `automations_paused_at` text;