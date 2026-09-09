-- The project's DEFAULT release (epic #E48): where a completed quest that
-- names no release, and inherits none from its epic, lands.
--
-- A plain additive ADD COLUMN: `defaultSince` is declared optional with NO
-- `db.default`, because a column DEFAULT is what turns this into a table
-- rebuild, and on D1 a rebuild fires every referencing ON DELETE clause.
-- Precedent: `20260830124318_epic_release_id`.
--
-- ⚠️ The index is NON-UNIQUE and must stay that way. A partial
-- `UNIQUE (project_id) WHERE default_since IS NOT NULL` is the obvious guard
-- and is a bug: SQLite checks uniqueness per row as an UPDATE walks the table,
-- so the single-statement swap in `ReleaseController.setDefaultRelease`
-- transiently holds two default rows and throws depending on row order. There
-- is no deferred constraint in SQLite. The invariant is the one write path.

ALTER TABLE `releases` ADD `default_since` integer;--> statement-breakpoint
CREATE INDEX `releases_project_id_default_since_idx` ON `releases` (`project_id`,`default_since`);
