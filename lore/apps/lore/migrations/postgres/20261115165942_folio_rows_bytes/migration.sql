ALTER TABLE "folio_rows" ADD COLUMN "bytes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- #Q3708: backfill every existing row's size, the UTF-8 length of its stored
-- cells as JSON text.
UPDATE "folio_rows" SET "bytes" = octet_length("cells"::text);
