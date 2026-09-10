-- An epic's status becomes planned | ready | in_progress | completed (#Q2223),
-- replacing epic #31's planned | active | done ratchet. `ready` is new and
-- set by hand; `in_progress` and `completed` are now written by the quest
-- requests that make them true (the first accept, the last resolution).
--
-- ⚠️ The two UPDATEs on `status` are load-bearing, not tidy. `status` is a
-- `mode: "text"` enum with no CHECK constraint, so SQLite would keep the old
-- values happily, but the entity validates it on READ: a row still saying
-- `active` or `done` fails to decode and takes every epic query with it. The
-- 2026-08-05 incident was the same shape (see apps/lore/CLAUDE.md, "Renaming a
-- REQUIRED key inside a JSON column").
--
-- The rename is a plain RENAME COLUMN, generated with a drizzle hint: without
-- it drizzle emits a DROP + ADD and loses every start date. No DROP TABLE, so
-- nothing cascades on D1.

ALTER TABLE `epics` RENAME COLUMN `activated_at` TO `started_at`;--> statement-breakpoint
UPDATE `epics` SET `status` = 'in_progress' WHERE `status` = 'active';--> statement-breakpoint
UPDATE `epics` SET `status` = 'completed' WHERE `status` = 'done';--> statement-breakpoint
-- An in-progress epic with nothing left open would be stuck for good: only
-- the request that resolves its last quest completes it, and that request
-- already happened. Completed at the moment its last quest was resolved,
-- which is the date the new rule would have written. A shelved quest carries
-- no `completed_at` (shelving is only reachable from `new`), hence COALESCE.
UPDATE `epics` SET
  `status` = 'completed',
  `completed_at` = (
    SELECT MAX(COALESCE(`q`.`completed_at`, `q`.`shelved_at`))
    FROM `quests` `q`
    WHERE `q`.`epic_id` = `epics`.`id` AND `q`.`deleted_at` IS NULL
  )
WHERE `status` = 'in_progress'
  AND EXISTS (
    SELECT 1 FROM `quests` `q`
    WHERE `q`.`epic_id` = `epics`.`id` AND `q`.`deleted_at` IS NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM `quests` `q`
    WHERE `q`.`epic_id` = `epics`.`id` AND `q`.`deleted_at` IS NULL
      AND `q`.`completed_at` IS NULL AND `q`.`shelved_at` IS NULL
  );--> statement-breakpoint
-- An in-progress epic with no quest at all could never start work nor
-- complete, and its frozen plan could not gain one. Nothing was ever worked
-- in it, so it goes back to `ready`, where quests can be added again.
UPDATE `epics` SET `status` = 'ready', `started_at` = NULL
WHERE `status` = 'in_progress'
  AND NOT EXISTS (
    SELECT 1 FROM `quests` `q`
    WHERE `q`.`epic_id` = `epics`.`id` AND `q`.`deleted_at` IS NULL
  );
