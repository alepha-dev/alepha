ALTER TABLE `folios` RENAME COLUMN `trashed_at` TO `deleted_at`;--> statement-breakpoint
-- #Q3698: the Trash directory goes, and a deleted folio is soft-deleted.
-- `trashed_at` became `deleted_at` above, so a folio already stamped in the
-- Trash is deleted from now on, keeping its date and its 30 days. Every
-- folio anywhere under a Trash directory, stamped or not, becomes deleted
-- (dated now when it had no stamp) and leaves the directory, so the delete
-- below cascades no folio. Their name reservations are released, as a
-- deletion does. The Trash directories, and any directory moved into one,
-- are then deleted: that directory structure is lost, accepted pre-v1; the
-- folios it held are in Recently deleted.
UPDATE `folios` SET
  `deleted_at` = COALESCE(`deleted_at`, CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  `directory_id` = NULL
WHERE `directory_id` IN (
  WITH RECURSIVE `trash`(`id`) AS (
    SELECT `id` FROM `folio_directories` WHERE `system` = 'trash'
    UNION ALL
    SELECT `d`.`id` FROM `folio_directories` `d` JOIN `trash` `t` ON `d`.`parent_id` = `t`.`id`
  )
  SELECT `id` FROM `trash`
);--> statement-breakpoint
DELETE FROM `folio_names` WHERE `kind` = 'folio'
  AND `entity_id` IN (SELECT `id` FROM `folios` WHERE `deleted_at` IS NOT NULL);--> statement-breakpoint
DELETE FROM `folio_names` WHERE `kind` = 'directory' AND `entity_id` IN (
  WITH RECURSIVE `trash`(`id`) AS (
    SELECT `id` FROM `folio_directories` WHERE `system` = 'trash'
    UNION ALL
    SELECT `d`.`id` FROM `folio_directories` `d` JOIN `trash` `t` ON `d`.`parent_id` = `t`.`id`
  )
  SELECT `id` FROM `trash`
);--> statement-breakpoint
DELETE FROM `folio_directories` WHERE `system` = 'trash';
