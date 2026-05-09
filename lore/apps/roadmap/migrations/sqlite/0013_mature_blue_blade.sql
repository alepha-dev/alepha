ALTER TABLE `api_keys` ADD `organization_id` text;--> statement-breakpoint
ALTER TABLE `audits` ADD `organization_id` text;--> statement-breakpoint
ALTER TABLE `files` ADD `organization_id` text;--> statement-breakpoint
CREATE INDEX `job_executions_job_name_status_created_at_idx` ON `job_executions` (`job_name`,`status`,`created_at`);