-- #Q3717: a calendar is its own folio type. A table last read on its
-- calendar view becomes a calendar folio, so it keeps showing what its
-- readers last saw; its columns and rows are untouched. Every other table
-- stays a grid. No row is deleted and no table is rebuilt.
UPDATE `folios` SET `type` = 'calendar'
WHERE `type` = 'table'
  AND `id` IN (SELECT `folio_id` FROM `folio_views` WHERE `kind` = 'calendar');
