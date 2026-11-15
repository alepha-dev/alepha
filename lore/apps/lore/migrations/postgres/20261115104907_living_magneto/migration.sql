CREATE TABLE "folio_views" (
	"id" uuid PRIMARY KEY,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"folio_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"date_column_id" text,
	"title_column_id" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "folio_views_folio_id_idx" ON "folio_views" ("folio_id");--> statement-breakpoint
ALTER TABLE "folio_views" ADD CONSTRAINT "folio_views_folio_id_folios_id_fkey" FOREIGN KEY ("folio_id") REFERENCES "folios"("id") ON DELETE CASCADE;