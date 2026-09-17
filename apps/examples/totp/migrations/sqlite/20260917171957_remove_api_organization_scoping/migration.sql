ALTER TABLE `audits` DROP COLUMN `organization_id`;--> statement-breakpoint
ALTER TABLE `job_executions` DROP COLUMN `organization_id`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `organization_id`;