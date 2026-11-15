CREATE TABLE "folio_columns" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"folio_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"lower_name" text NOT NULL,
	"type" text NOT NULL,
	"options" jsonb DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "folio_rows" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"folio_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"position" double precision NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"cells" jsonb DEFAULT '{}' NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"updated_by_user_id" uuid
);
--> statement-breakpoint
ALTER TABLE "folios" ADD COLUMN "type" text DEFAULT 'text' NOT NULL;--> statement-breakpoint
CREATE INDEX "folio_columns_folio_id_position_idx" ON "folio_columns" ("folio_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "folio_columns_folio_id_lower_name_idx" ON "folio_columns" ("folio_id","lower_name");--> statement-breakpoint
CREATE INDEX "folio_rows_folio_id_position_idx" ON "folio_rows" ("folio_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "folio_rows_folio_id_number_idx" ON "folio_rows" ("folio_id","number");--> statement-breakpoint
ALTER TABLE "folio_columns" ADD CONSTRAINT "folio_columns_folio_id_folios_id_fkey" FOREIGN KEY ("folio_id") REFERENCES "folios"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "folio_rows" ADD CONSTRAINT "folio_rows_folio_id_folios_id_fkey" FOREIGN KEY ("folio_id") REFERENCES "folios"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "folio_rows" ADD CONSTRAINT "folio_rows_updated_by_user_id_users_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;