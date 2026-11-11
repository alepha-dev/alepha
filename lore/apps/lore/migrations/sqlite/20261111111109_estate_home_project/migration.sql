ALTER TABLE `estates` ADD `project_id` integer REFERENCES projects(id) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE `estates` ADD `created_by` text REFERENCES users(id) ON DELETE SET NULL;--> statement-breakpoint
DROP INDEX IF EXISTS `estates_owner_user_id_slug_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `estates_project_id_slug_idx` ON `estates` (`project_id`,`slug`);