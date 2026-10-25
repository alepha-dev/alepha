-- #E75 / #Q2627: `folios.epic_id` goes, by DROP COLUMN only. An epic's folios
-- are `filed` rows in `folio_links` since #Q2626, and nothing reads the column.
--
-- ⚠️ Hand-written. drizzle-kit generates a rebuild of `folios` here, whose
-- `DROP TABLE` would fire the CASCADE of `folio_revisions` and
-- `folio_attachments`: forbidden on a cascade parent (apps/lore/CLAUDE.md,
-- "Migration safety on D1"). The column was added by `ALTER TABLE ADD ...
-- REFERENCES epics(id)` (20260819094801_ancient_vermin), so its foreign key
-- is column-level, and SQLite drops such a column in place; no index names it.
--
-- 1. The backfill again: a filing the previous Worker wrote between #Q2626's
--    migration and its deploy still lands in the graph before the column goes.
-- alepha-rehearse-allow-insert: filings written between #Q2626's migration and its deploy
INSERT OR IGNORE INTO `folio_links` (`from_type`, `from_id`, `target_type`, `to_id`, `relation`)
SELECT 'epic', CAST(`epic_id` AS TEXT), 'folio', `id`, 'filed' FROM `folios` WHERE `epic_id` IS NOT NULL;--> statement-breakpoint
-- 2. The drop, in place.
ALTER TABLE `folios` DROP COLUMN `epic_id`;
