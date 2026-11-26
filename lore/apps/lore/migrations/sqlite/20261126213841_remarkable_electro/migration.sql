ALTER TABLE `prompts` ADD `settle_seconds` integer;--> statement-breakpoint
ALTER TABLE `prompts` ADD `pending` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `prompts` ADD `pending_job_id` text;--> statement-breakpoint
ALTER TABLE `prompts` ADD `pending_event` text;--> statement-breakpoint
ALTER TABLE `prompts` ADD `pending_at` text;