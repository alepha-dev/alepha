-- #E75 / #Q2626: an epic's folios move from `folios.epic_id` to `filed` rows
-- in core's link graph, so a folio no longer knows which epic files it
-- (folio #F1356, decision 8). Additive only: `folio_links` is a leaf, and
-- `folios.epic_id` stays until #Q2627 drops it, read and written by nothing.
--
-- 1. The relation: NULL is a mention parsed from a body, as every row so far.
ALTER TABLE `folio_links` ADD `relation` text;--> statement-breakpoint
-- 2. The unique key gains it, so an epic that both files a folio and mentions
--    it in its description holds two rows. A DROP INDEX / CREATE INDEX, no
--    rebuild.
DROP INDEX IF EXISTS `folio_links_from_type_from_id_target_type_to_id_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `folio_links_from_type_from_id_target_type_to_id_relation_idx` ON `folio_links` (`from_type`,`from_id`,`target_type`,`to_id`,`relation`);--> statement-breakpoint
-- 3. The backfill: one `filed` row per folio filed under an epic. `from_id`
--    is the epic id as text, like every integer source; `created_at` takes
--    the column default. #Q2627 runs it again before the drop, to catch a
--    filing the previous Worker wrote between this migration and the deploy.
INSERT OR IGNORE INTO `folio_links` (`from_type`, `from_id`, `target_type`, `to_id`, `relation`)
SELECT 'epic', CAST(`epic_id` AS TEXT), 'folio', `id`, 'filed' FROM `folios` WHERE `epic_id` IS NOT NULL;
