ALTER TABLE "folios" RENAME COLUMN "trashed_at" TO "deleted_at";--> statement-breakpoint
-- #Q3698: see the sqlite migration of the same name for the reasoning.
WITH RECURSIVE "trash"("id") AS (
  SELECT "id" FROM "folio_directories" WHERE "system" = 'trash'
  UNION ALL
  SELECT "d"."id" FROM "folio_directories" "d" JOIN "trash" "t" ON "d"."parent_id" = "t"."id"
)
UPDATE "folios" SET "deleted_at" = COALESCE("deleted_at", now()), "directory_id" = NULL
WHERE "directory_id" IN (SELECT "id" FROM "trash");--> statement-breakpoint
DELETE FROM "folio_names" WHERE "kind" = 'folio'
  AND "entity_id" IN (SELECT CAST("id" AS TEXT) FROM "folios" WHERE "deleted_at" IS NOT NULL);--> statement-breakpoint
WITH RECURSIVE "trash"("id") AS (
  SELECT "id" FROM "folio_directories" WHERE "system" = 'trash'
  UNION ALL
  SELECT "d"."id" FROM "folio_directories" "d" JOIN "trash" "t" ON "d"."parent_id" = "t"."id"
)
DELETE FROM "folio_names" WHERE "kind" = 'directory'
  AND "entity_id" IN (SELECT CAST("id" AS TEXT) FROM "trash");--> statement-breakpoint
DELETE FROM "folio_directories" WHERE "system" = 'trash';
