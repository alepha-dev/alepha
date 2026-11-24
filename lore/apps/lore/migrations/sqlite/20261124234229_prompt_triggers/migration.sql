ALTER TABLE `projects` RENAME COLUMN `automations_paused_at` TO `prompts_paused_at`;--> statement-breakpoint
ALTER TABLE `prompts` ADD `event_keys` text;--> statement-breakpoint
ALTER TABLE `prompts` ADD `settle_seconds` integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE `prompts` ADD `pending` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `prompts` ADD `pending_job_id` text;--> statement-breakpoint
ALTER TABLE `prompts` ADD `schedule` text;--> statement-breakpoint
ALTER TABLE `prompts` ADD `daily_hour` integer;--> statement-breakpoint
ALTER TABLE `prompts` ADD `weekday` integer;--> statement-breakpoint
ALTER TABLE `prompts` ADD `next_run_at` text;--> statement-breakpoint
ALTER TABLE `prompts` ADD `check` text;--> statement-breakpoint
ALTER TABLE `prompts` ADD `arg_values` text;--> statement-breakpoint
ALTER TABLE `prompts` ADD `max_runs_per_hour` integer DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE `prompts` ADD `max_runs_per_day` integer DEFAULT 48 NOT NULL;--> statement-breakpoint
ALTER TABLE `prompts` ADD `consecutive_failures` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `prompts` ADD `last_job_id` text;--> statement-breakpoint
ALTER TABLE `prompts` ADD `last_run_at` text;--> statement-breakpoint
ALTER TABLE `prompts` ADD `last_skipped_at` text;--> statement-breakpoint
ALTER TABLE `prompts` ADD `last_skipped_reason` text;--> statement-breakpoint
DROP INDEX IF EXISTS `agent_automations_project_id_name_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `agent_automations_next_run_at_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `host_jobs_automation_id_status_idx`;--> statement-breakpoint
CREATE INDEX `prompts_next_run_at_idx` ON `prompts` (`next_run_at`);--> statement-breakpoint
-- alepha-allow-drop-table: agent automations become triggers on prompts (#Q4277); a leaf (host_jobs.automation_id was a soft reference), no data migration
DROP TABLE `agent_automations`;--> statement-breakpoint
ALTER TABLE `host_jobs` DROP COLUMN `automation_id`;--> statement-breakpoint
ALTER TABLE `project_thresholds` DROP COLUMN `automation_builds_per_day`;