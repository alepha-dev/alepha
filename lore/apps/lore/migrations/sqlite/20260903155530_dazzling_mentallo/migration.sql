-- `IF NOT EXISTS` is hand-added, and load-bearing. `d1MigrationsApply` runs a
-- migration's SQL and records its `d1_migrations` row as two separate calls,
-- so an apply interrupted between them leaves the statements applied and the
-- migration still pending. That is the state lore-production reached on
-- 2026-09-04: all five indexes present, no bookkeeping row, and every
-- subsequent deploy failing on the first CREATE INDEX. Re-running has to be a
-- no-op for the retry to reach the INSERT.
CREATE INDEX IF NOT EXISTS `epics_project_id_updated_at_idx` ON `epics` (`project_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `folio_revisions_at_idx` ON `folio_revisions` (`at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `quest_comments_created_at_idx` ON `quest_comments` (`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `quests_project_id_updated_at_idx` ON `quests` (`project_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `releases_project_id_updated_at_idx` ON `releases` (`project_id`,`updated_at`);
