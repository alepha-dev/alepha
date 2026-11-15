ALTER TABLE `monitors` ADD `app_instance_id` text REFERENCES app_instances(id) ON DELETE CASCADE;--> statement-breakpoint
CREATE INDEX `monitors_app_instance_id_idx` ON `monitors` (`app_instance_id`);