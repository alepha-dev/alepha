DROP INDEX `parameters_name_activation_date_idx`;--> statement-breakpoint
DROP INDEX `parameters_name_version_idx`;--> statement-breakpoint
ALTER TABLE `parameters` ADD `organization_id` text;--> statement-breakpoint
CREATE INDEX `parameters_organization_id_name_activation_date_idx` ON `parameters` (`organization_id`,`name`,`activation_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `parameters_organization_id_name_version_idx` ON `parameters` (`organization_id`,`name`,`version`);