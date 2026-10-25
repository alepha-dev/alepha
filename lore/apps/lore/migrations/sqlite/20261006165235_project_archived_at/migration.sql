-- When an owner archived the project (#Q2601), NULL while it is live.
--
-- A plain additive ADD COLUMN: `archivedAt` is declared optional with NO
-- `db.default`, because a column DEFAULT is what turns this into a `projects`
-- rebuild, and on D1 a rebuild fires every referencing ON DELETE clause.

ALTER TABLE `projects` ADD `archived_at` integer;