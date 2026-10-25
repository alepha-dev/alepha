ALTER TABLE `audits` ADD `scope_type` text;--> statement-breakpoint
ALTER TABLE `audits` ADD `scope_id` text;--> statement-breakpoint
DROP INDEX IF EXISTS `audits_type_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `audits_action_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `audits_user_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `audits_user_realm_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `audits_resource_type_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `audits_resource_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `audits_severity_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `audits_type_action_idx`;--> statement-breakpoint
CREATE INDEX `audits_scope_type_scope_id_created_at_idx` ON `audits` (`scope_type`,`scope_id`,`created_at`) WHERE scope_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `audits_scope_type_scope_id_user_id_created_at_idx` ON `audits` (`scope_type`,`scope_id`,`user_id`,`created_at`) WHERE scope_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `audits_scope_type_scope_id_type_action_created_at_idx` ON `audits` (`scope_type`,`scope_id`,`type`,`action`,`created_at`) WHERE scope_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `audits_scope_type_scope_id_action_created_at_idx` ON `audits` (`scope_type`,`scope_id`,`action`,`created_at`) WHERE scope_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `audits_type_action_created_at_idx` ON `audits` (`type`,`action`,`created_at`);--> statement-breakpoint
CREATE INDEX `audits_resource_type_resource_id_created_at_idx` ON `audits` (`resource_type`,`resource_id`,`created_at`);