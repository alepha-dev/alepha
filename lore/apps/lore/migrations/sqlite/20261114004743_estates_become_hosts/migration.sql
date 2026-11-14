ALTER TABLE `analytics_estate_stats_raw` RENAME TO `analytics_host_stats_raw`;--> statement-breakpoint
ALTER TABLE `analytics_estate_stats_rolled` RENAME TO `analytics_host_stats_rolled`;--> statement-breakpoint
ALTER TABLE `estate_commands` RENAME TO `host_commands`;--> statement-breakpoint
ALTER TABLE `estate_events` RENAME TO `host_events`;--> statement-breakpoint
ALTER TABLE `estate_inventories` RENAME TO `host_inventories`;--> statement-breakpoint
ALTER TABLE `estate_projects` RENAME TO `host_projects`;--> statement-breakpoint
ALTER TABLE `estates` RENAME TO `hosts`;--> statement-breakpoint
ALTER TABLE `analytics_host_stats_raw` RENAME COLUMN `estate_id` TO `host_id`;--> statement-breakpoint
ALTER TABLE `analytics_host_stats_rolled` RENAME COLUMN `estate_id` TO `host_id`;--> statement-breakpoint
ALTER TABLE `app_instances` RENAME COLUMN `estate_id` TO `host_id`;--> statement-breakpoint
ALTER TABLE `app_instances` RENAME COLUMN `resource_estate_id` TO `resource_host_id`;--> statement-breakpoint
ALTER TABLE `host_commands` RENAME COLUMN `estate_id` TO `host_id`;--> statement-breakpoint
ALTER TABLE `host_events` RENAME COLUMN `estate_id` TO `host_id`;--> statement-breakpoint
ALTER TABLE `host_inventories` RENAME COLUMN `estate_id` TO `host_id`;--> statement-breakpoint
ALTER TABLE `host_inventories` RENAME COLUMN `host` TO `machine`;--> statement-breakpoint
ALTER TABLE `host_projects` RENAME COLUMN `estate_id` TO `host_id`;--> statement-breakpoint
ALTER TABLE `sigils` RENAME COLUMN `last_seen_host` TO `last_seen_hostname`;--> statement-breakpoint
ALTER TABLE `stack_deployments` RENAME COLUMN `estate_id` TO `host_id`;--> statement-breakpoint
ALTER TABLE `stack_environments` RENAME COLUMN `estate_id` TO `host_id`;--> statement-breakpoint
ALTER TABLE `stacks` RENAME COLUMN `estate_id` TO `host_id`;--> statement-breakpoint
DROP INDEX IF EXISTS `analytics_estate_stats_raw_time_bucket_estate_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `analytics_estate_stats_rolled_time_bucket_estate_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `app_instances_estate_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `estate_commands_estate_id_status_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `estate_commands_estate_id_created_at_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `estate_events_estate_id_event_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `estate_events_estate_id_app_env_at_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `estate_inventories_estate_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `estate_projects_estate_id_project_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `estate_projects_project_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `estates_project_id_slug_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `estates_secret_hash_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `estates_enrolment_hash_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `stack_environments_estate_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `stacks_estate_id_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_host_stats_raw_time_bucket_host_id_idx` ON `analytics_host_stats_raw` (`time_bucket`,`host_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_host_stats_rolled_time_bucket_host_id_idx` ON `analytics_host_stats_rolled` (`time_bucket`,`host_id`);--> statement-breakpoint
CREATE INDEX `app_instances_host_id_idx` ON `app_instances` (`host_id`);--> statement-breakpoint
CREATE INDEX `host_commands_host_id_status_idx` ON `host_commands` (`host_id`,`status`);--> statement-breakpoint
CREATE INDEX `host_commands_host_id_created_at_idx` ON `host_commands` (`host_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `host_events_host_id_event_id_idx` ON `host_events` (`host_id`,`event_id`);--> statement-breakpoint
CREATE INDEX `host_events_host_id_app_env_at_idx` ON `host_events` (`host_id`,`app`,`env`,`at`);--> statement-breakpoint
CREATE UNIQUE INDEX `host_inventories_host_id_idx` ON `host_inventories` (`host_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `host_projects_host_id_project_id_idx` ON `host_projects` (`host_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `host_projects_project_id_idx` ON `host_projects` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `hosts_project_id_slug_idx` ON `hosts` (`project_id`,`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `hosts_secret_hash_idx` ON `hosts` (`secret_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `hosts_enrolment_hash_idx` ON `hosts` (`enrolment_hash`);--> statement-breakpoint
CREATE INDEX `stack_environments_host_id_idx` ON `stack_environments` (`host_id`);--> statement-breakpoint
CREATE INDEX `stacks_host_id_idx` ON `stacks` (`host_id`);--> statement-breakpoint
-- Estate becomes host (#E147, #Q3555). The tables and columns above are
-- renamed in place, rows kept; the inventory's machine block, `host` before,
-- is `machine`, and a sigil's `last_seen_host` is `last_seen_hostname`.
-- Below, every identifier a row stores is rewritten. Bay's wire v1 does not
-- live in the database and keeps its spelling in the code.
--
-- Permissions, exact and wildcard, in ranks and API keys (JSON text arrays).
UPDATE `organization_ranks`
SET `permissions` = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(`permissions`,
  '"estate:read"', '"host:read"'),
  '"estate:create"', '"host:create"'),
  '"estate:update"', '"host:update"'),
  '"estate:delete"', '"host:delete"'),
  '"estate:lend"', '"host:lend"'),
  '"estate:*"', '"host:*"')
WHERE `permissions` LIKE '%"estate:%';--> statement-breakpoint
UPDATE `api_keys`
SET `permissions` = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(`permissions`,
  '"estate:read"', '"host:read"'),
  '"estate:create"', '"host:create"'),
  '"estate:update"', '"host:update"'),
  '"estate:delete"', '"host:delete"'),
  '"estate:lend"', '"host:lend"'),
  '"estate:*"', '"host:*"')
WHERE `permissions` LIKE '%"estate:%';--> statement-breakpoint
-- The audit type and resource type, so the Activity filter still finds the
-- old rows.
UPDATE `audits` SET `type` = 'host' WHERE `type` = 'estate';--> statement-breakpoint
UPDATE `audits` SET `resource_type` = 'host' WHERE `resource_type` = 'estate';--> statement-breakpoint
UPDATE `audits` SET `scope_type` = 'host' WHERE `scope_type` = 'estate';--> statement-breakpoint
-- The notification category and the overdue template, in the inbox, in
-- muted categories and in suppressions.
UPDATE `notification_inbox` SET `template` = 'lore:host:overdue' WHERE `template` = 'lore:estate:overdue';--> statement-breakpoint
UPDATE `notification_inbox` SET `category` = 'hosts' WHERE `category` = 'estates';--> statement-breakpoint
UPDATE `notification_preferences`
SET `muted_categories` = REPLACE(`muted_categories`, '"estates"', '"hosts"')
WHERE `muted_categories` LIKE '%"estates"%';--> statement-breakpoint
UPDATE `notification_suppressions` SET `category` = 'hosts' WHERE `category` = 'estates';--> statement-breakpoint
-- The stats dataset's prune floor, keyed by its name.
UPDATE `analytics_prune_floors` SET `dataset` = 'host_stats' WHERE `dataset` = 'estate_stats';
