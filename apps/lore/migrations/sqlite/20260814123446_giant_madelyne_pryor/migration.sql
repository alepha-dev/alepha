-- Attachments become folio-scoped: `folio_id` is added, and `directory_id`
-- stops being read.
--
-- Two hand edits to what drizzle-kit generated, both load-bearing:
--
--   1. `NOT NULL` was dropped from the ADD COLUMN. SQLite refuses to add a
--      column that carries a REFERENCES clause unless it defaults to NULL —
--      at ANY table size, so an empty table does not rescue it. The generated
--      statement fails on every database, including a fresh one.
--   2. The two DELETEs were added. A blob that lived in a directory has no
--      folio to belong to, so there is nothing to backfill `folio_id` with
--      and the row is unreachable in the new model. Production holds no folio
--      blobs, so this deletes nothing there.
--
-- `directory_id` is deliberately NOT dropped. SQLite cannot drop a column
-- that carries a foreign key, and removing the FK means rebuilding the table
-- — which on D1 cascade-deletes every child row (the 2026-05 incident;
-- `folio_blobs` is in `test/migration-safety.spec.ts`'s PROTECTED_TABLES for
-- that reason). The column stays declared on the entity as `@deprecated` so
-- the snapshot keeps matching the disk, exactly as `projects.public` does.
--
-- ACCEPTED DRIFT: `folio_id` is physically nullable while the entity declares
-- it required — see edit 1. `check:migrations` cannot see this (drizzle diffs
-- the entity against the snapshot, never the live database), so it is
-- recorded here and in the entity. `FolioBlobService.register` is what
-- actually enforces the folio.
DELETE FROM `folio_names` WHERE `kind` = 'blob';--> statement-breakpoint
DELETE FROM `folio_blobs`;--> statement-breakpoint
ALTER TABLE `folio_blobs` ADD `folio_id` text REFERENCES folios(id) ON DELETE CASCADE;--> statement-breakpoint
DROP INDEX IF EXISTS `folio_blobs_directory_id_idx`;--> statement-breakpoint
CREATE INDEX `folio_blobs_folio_id_idx` ON `folio_blobs` (`folio_id`);
