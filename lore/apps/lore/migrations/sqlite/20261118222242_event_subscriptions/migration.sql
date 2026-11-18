CREATE TABLE `event_subscriptions` (
	`id` text PRIMARY KEY,
	`project_id` integer NOT NULL,
	`key` text NOT NULL,
	`event` text NOT NULL,
	`filter` text,
	`member_id` text,
	`channels` text NOT NULL,
	`created_by` text,
	`muted_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	CONSTRAINT `fk_event_subscriptions_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_event_subscriptions_member_id_users_id_fk` FOREIGN KEY (`member_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_event_subscriptions_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_subscriptions_project_id_key_idx` ON `event_subscriptions` (`project_id`,`key`);--> statement-breakpoint
CREATE INDEX `event_subscriptions_project_id_event_idx` ON `event_subscriptions` (`project_id`,`event`);--> statement-breakpoint
CREATE INDEX `event_subscriptions_member_id_idx` ON `event_subscriptions` (`member_id`);--> statement-breakpoint
-- Notifications (#E159, #Q3890): `subscription:manage` wherever
-- `automation:manage` is held, `subscription:read` wherever
-- `automation:read` is, and `subscription:*` for `automation:*`, in ranks
-- and API keys (JSON text arrays). A stored rank is never reseeded, so
-- without this an Admin would lose what an automation manager could do.
UPDATE `organization_ranks` SET `permissions` = json_insert(`permissions`, '$[#]', 'subscription:manage')
WHERE EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE value = 'automation:manage')
  AND NOT EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE value = 'subscription:manage');--> statement-breakpoint
UPDATE `organization_ranks` SET `permissions` = json_insert(`permissions`, '$[#]', 'subscription:read')
WHERE EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE value = 'automation:read')
  AND NOT EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE value = 'subscription:read');--> statement-breakpoint
UPDATE `organization_ranks` SET `permissions` = json_insert(`permissions`, '$[#]', 'subscription:*')
WHERE EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE value = 'automation:*')
  AND NOT EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE value = 'subscription:*');--> statement-breakpoint
UPDATE `api_keys` SET `permissions` = json_insert(`permissions`, '$[#]', 'subscription:manage')
WHERE EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE value = 'automation:manage')
  AND NOT EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE value = 'subscription:manage');--> statement-breakpoint
UPDATE `api_keys` SET `permissions` = json_insert(`permissions`, '$[#]', 'subscription:read')
WHERE EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE value = 'automation:read')
  AND NOT EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE value = 'subscription:read');--> statement-breakpoint
UPDATE `api_keys` SET `permissions` = json_insert(`permissions`, '$[#]', 'subscription:*')
WHERE EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE value = 'automation:*')
  AND NOT EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE value = 'subscription:*');
