-- #Q2549: `folios` gets `db.version()`. An update or a revert writes against
-- the version its own request read, and D1 has no transaction to keep a
-- concurrent write from landing in between; the version makes that write
-- answer 409 instead of overwriting it.
--
-- An ADD COLUMN with a constant default: no rebuild. `folios` is a cascade
-- child of `projects` and the cascade parent of `folio_revisions`, and a
-- rebuild on D1 would cascade-wipe (see "Migration safety on D1"). Existing
-- rows start at 0.
ALTER TABLE `folios` ADD `version` integer DEFAULT 0 NOT NULL;
