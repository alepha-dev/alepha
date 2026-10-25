-- #Q2491: the newest revision of a folio no longer copies the body. It would
-- be byte-identical to `folios.content`, which is the row it documents: on
-- 2026-09-23 that was 603 rows and 5 MB of production's 59 MB. The head is
-- written with `snapshot_is_live` and an empty snapshot, and the reader
-- answers the live content for it.
--
-- An ADD COLUMN with a constant default: no rebuild. `folio_revisions` is a
-- cascade child of `folios`, itself a cascade child of `projects`, and a
-- rebuild on D1 would cascade-wipe (see "Migration safety on D1").
ALTER TABLE `folio_revisions` ADD `snapshot_is_live` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Backfill, data only: the newest revision of each folio, and only when its
-- snapshot is exactly the live content, so no body is lost. Ties on `at` are
-- broken by `id`, the order the reader uses. Older rows stay full snapshots.
UPDATE `folio_revisions`
SET `content_snapshot` = '', `snapshot_is_live` = 1
WHERE `id` = (
    SELECT `r2`.`id` FROM `folio_revisions` AS `r2`
    WHERE `r2`.`folio_id` = `folio_revisions`.`folio_id`
    ORDER BY `r2`.`at` DESC, `r2`.`id` DESC
    LIMIT 1
  )
  AND `content_snapshot` = (
    SELECT `f`.`content` FROM `folios` AS `f`
    WHERE `f`.`id` = `folio_revisions`.`folio_id`
  );
