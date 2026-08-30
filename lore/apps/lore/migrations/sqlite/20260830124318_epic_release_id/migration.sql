-- An epic belongs to at most one release (epic #14 "Lore Release").
--
-- A plain additive ADD COLUMN: `releaseId` is declared optional with NO
-- `db.default`, because a column DEFAULT is what turns this into a table
-- rebuild on D1. Precedent: `quests.epicId`.
--
-- ON DELETE SET NULL, never CASCADE: deleting a release orphans its epics, it
-- never deletes them. Deleting a release has to stay cheap - a release that
-- locks itself is exactly what made the milestone recorder unusable.

ALTER TABLE `epics` ADD `release_id` integer REFERENCES releases(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `epics_release_id_idx` ON `epics` (`release_id`);
