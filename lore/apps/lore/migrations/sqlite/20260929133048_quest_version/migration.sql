-- #Q2546: `quests` gets `db.version()`. Every status change `save()`s the row
-- its gate read, and D1 has no transaction to keep a concurrent write from
-- landing in between; the version makes that `save()` answer 409 instead of
-- reverting the other write.
--
-- An ADD COLUMN with a constant default: no rebuild. `quests` is a cascade
-- child of `projects`, and a rebuild on D1 would cascade-wipe (see "Migration
-- safety on D1"). Existing rows start at 0.
ALTER TABLE `quests` ADD `version` integer DEFAULT 0 NOT NULL;
