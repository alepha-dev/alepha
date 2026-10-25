-- Milestones become Releases (epic #14 "Lore Release").
--
-- This is a NEW FEATURE, not a data migration: every milestone row is
-- deleted, by the owner's decision. Releases start empty in every project,
-- production included. Quests are untouched.
--
-- ⚠️ DELETE then RENAME, never DROP then CREATE. `milestones` has exactly one
-- inbound foreign key, `quests.milestone_id`, and it is ON DELETE SET NULL,
-- so the wipe cannot reach a quest. But dropping the table would leave
-- `quests`'s FK clause naming a table that no longer exists, and repointing
-- an FK in SQLite means rebuilding the REFERENCING table — i.e. DROP TABLE
-- quests, which on D1 cascade-wipes every quest comment and every questline
-- link. `RENAME TO` rewrites the referencing DDL automatically. Precedent:
-- 20260805005114_green_captain_universe. There is no DROP TABLE below.

-- Null the FK explicitly rather than relying on ON DELETE SET NULL firing.
-- D1 enforces foreign keys and would do it; a local SQLite with
-- `PRAGMA foreign_keys=OFF` would not, and would leave orphan ids behind.
-- Doing it by hand makes both databases end in the same state.
UPDATE `quests` SET `milestone_id` = NULL;--> statement-breakpoint
DELETE FROM `milestones`;--> statement-breakpoint
ALTER TABLE `milestones` RENAME TO `releases`;--> statement-breakpoint
ALTER TABLE `quests` RENAME COLUMN `milestone_id` TO `release_id`;--> statement-breakpoint
DROP INDEX IF EXISTS `quests_milestone_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `milestones_project_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `milestones_project_id_number_idx`;--> statement-breakpoint
CREATE INDEX `quests_release_id_idx` ON `quests` (`release_id`);--> statement-breakpoint
CREATE INDEX `releases_project_id_idx` ON `releases` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `releases_project_id_number_idx` ON `releases` (`project_id`,`number`);--> statement-breakpoint

-- `$sequence` keys its counter row on the PROPERTY name, not the table, so
-- renaming `milestoneNumber` to `releaseNumber` orphans the old row. Here
-- that is the correct outcome rather than the hazard it usually is: with no
-- releases left, `releaseNumber` starting at 1 is right, and there is no
-- history for it to collide with. This DELETE only sweeps the orphan.
DELETE FROM `alepha_sequences` WHERE `name` = 'milestoneNumber';--> statement-breakpoint

-- `dashboard_cards.scope` is a JSON column whose `kind` carried the literal
-- 'milestone' and whose payload carried `milestoneId` (dashboardScopeSchema).
-- Same hazard class as renaming a required JSON key, one level down: a
-- persisted JSON VALUE. No v1 metric accepts that kind and
-- `DashboardMetricCatalog.accepts()` gates card creation, so this is expected
-- to match zero rows — these two statements make the expectation unnecessary
-- rather than merely likely.
UPDATE `dashboard_cards`
  SET `scope` = json_set(`scope`, '$.kind', 'release')
  WHERE json_extract(`scope`, '$.kind') = 'milestone';--> statement-breakpoint
UPDATE `dashboard_cards`
  SET `scope` = json_remove(
    json_set(`scope`, '$.releaseId', json_extract(`scope`, '$.milestoneId')),
    '$.milestoneId'
  )
  WHERE json_extract(`scope`, '$.milestoneId') IS NOT NULL;
