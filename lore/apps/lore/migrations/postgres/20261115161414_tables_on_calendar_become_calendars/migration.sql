-- #Q3717: a calendar is its own folio type. A table last read on its
-- calendar view becomes a calendar folio, so it keeps showing what its
-- readers last saw; its columns and rows are untouched. Every other table
-- stays a grid.
UPDATE "folios" SET "type" = 'calendar'
WHERE "type" = 'table'
  AND "id" IN (SELECT "folio_id" FROM "folio_views" WHERE "kind" = 'calendar');
