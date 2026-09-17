DROP INDEX IF EXISTS `parameters_organization_id_name_activation_date_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `parameters_organization_id_name_version_idx`;--> statement-breakpoint
CREATE INDEX `parameters_name_activation_date_idx` ON `parameters` (`name`,`activation_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `parameters_name_version_idx` ON `parameters` (`name`,`version`);--> statement-breakpoint
ALTER TABLE `api_keys` DROP COLUMN `organization_id`;--> statement-breakpoint
ALTER TABLE `audits` DROP COLUMN `organization_id`;--> statement-breakpoint
ALTER TABLE `files` DROP COLUMN `organization_id`;--> statement-breakpoint
ALTER TABLE `invitations` DROP COLUMN `organization_id`;--> statement-breakpoint
ALTER TABLE `job_executions` DROP COLUMN `organization_id`;--> statement-breakpoint
ALTER TABLE `parameters` DROP COLUMN `organization_id`;--> statement-breakpoint
ALTER TABLE `rank_definitions` DROP COLUMN `organization_id`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `organization_id`;