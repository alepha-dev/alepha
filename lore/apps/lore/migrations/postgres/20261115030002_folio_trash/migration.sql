ALTER TABLE "folio_directories" ADD COLUMN "system" text;--> statement-breakpoint
ALTER TABLE "folio_directories" ADD COLUMN "trashed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "folios" ADD COLUMN "trashed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "folio_directories_project_id_system_idx" ON "folio_directories" ("project_id","system");