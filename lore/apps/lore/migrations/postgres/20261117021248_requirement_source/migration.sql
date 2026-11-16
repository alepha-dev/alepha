ALTER TABLE "requirements" ADD COLUMN "source_section_text" text;--> statement-breakpoint
ALTER TABLE "requirements" ADD COLUMN "source_changed" boolean;--> statement-breakpoint
ALTER TABLE "requirements" ADD COLUMN "source_change_kind" text;--> statement-breakpoint
ALTER TABLE "requirements" ADD COLUMN "source_changed_revision_id" text;