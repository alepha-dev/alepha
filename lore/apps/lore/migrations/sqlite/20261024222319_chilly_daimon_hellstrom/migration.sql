ALTER TABLE `deployments` ADD `command_id` text;--> statement-breakpoint
CREATE INDEX `deployments_command_id_idx` ON `deployments` (`command_id`);