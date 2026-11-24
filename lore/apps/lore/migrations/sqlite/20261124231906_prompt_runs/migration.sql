ALTER TABLE `host_jobs` ADD `prompt` text;--> statement-breakpoint
ALTER TABLE `host_jobs` ADD `args` text;--> statement-breakpoint
ALTER TABLE `host_jobs` ADD `cause` text;--> statement-breakpoint
ALTER TABLE `host_jobs` ADD `result` text;--> statement-breakpoint
ALTER TABLE `host_jobs` ADD `result_truncated` integer;--> statement-breakpoint
CREATE INDEX `host_jobs_project_id_prompt_status_idx` ON `host_jobs` (`project_id`,`prompt`,`status`);