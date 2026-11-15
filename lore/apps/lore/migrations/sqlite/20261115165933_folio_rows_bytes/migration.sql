ALTER TABLE `folio_rows` ADD `bytes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- #Q3708: backfill every existing row's size, the UTF-8 length of its stored
-- cells as JSON. A key whose column was removed counts until the row's next
-- write or column change, so an old row may read a little heavier, never
-- lighter. A constant default and an UPDATE: no table is rebuilt.
UPDATE `folio_rows` SET `bytes` = length(CAST(`cells` AS BLOB));
