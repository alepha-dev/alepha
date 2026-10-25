-- Folio name reservations, backfilled - see quest #1435.
--
-- Two changes, both additive. No DROP TABLE, no table rebuild, so this is
-- safe on D1 (see "Migration safety on D1" in apps/lore/CLAUDE.md).
--
-- 1. `root_scope` was left NULL for every reservation inside a directory.
--    SQLite treats NULLs as distinct in a UNIQUE index, so the index on
--    (parent_directory_id, root_scope, lower_name) bit at the project root
--    and nowhere else. Empty string instead, matching what
--    `FolioNameService.reserve` now writes.
UPDATE `folio_names` SET `root_scope` = '' WHERE `root_scope` IS NULL;--> statement-breakpoint
-- 2. Only directories ever reserved a name, so every folio that already
--    exists is unreserved and a new folio could silently take its name.
--    Reserve them all. `OR IGNORE` because a folio whose name is already
--    held by a sibling directory (possible precisely because folios were
--    never checked) must not fail the deploy - it keeps the name it has,
--    and the directory keeps the reservation.
--
--    The id is a v4 UUID built out of `randomblob`: `folio_names.id` is
--    read back as one by the entity schema, so `hex(randomblob(16))`
--    alone would not do.
INSERT OR IGNORE INTO `folio_names` (`id`, `parent_directory_id`, `root_scope`, `lower_name`, `kind`, `entity_id`)
SELECT
  lower(hex(randomblob(4))) || '-' ||
  lower(hex(randomblob(2))) || '-4' ||
  substr(lower(hex(randomblob(2))), 2) || '-' ||
  substr('89ab', abs(random()) % 4 + 1, 1) ||
  substr(lower(hex(randomblob(2))), 2) || '-' ||
  lower(hex(randomblob(6))),
  COALESCE(`directory_id`, 'root:' || CAST(`project_id` AS TEXT)),
  CASE WHEN `directory_id` IS NULL THEN CAST(`project_id` AS TEXT) ELSE '' END,
  lower(trim(`title`)),
  'folio',
  `id`
FROM `folios`
WHERE `id` NOT IN (SELECT `entity_id` FROM `folio_names`);
