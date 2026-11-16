CREATE TABLE "requirements" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "requirements_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"project_id" integer NOT NULL,
	"number" integer NOT NULL,
	"statement" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"type" text DEFAULT 'functional' NOT NULL,
	"priority" text DEFAULT 'should' NOT NULL,
	"chapter" text,
	"paragraph" text,
	"source_folio_id" text,
	"source_anchor" text,
	"source_revision_id" text,
	"target_release_id" integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX "requirements_project_id_number_idx" ON "requirements" ("project_id","number");--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_target_release_id_releases_id_fkey" FOREIGN KEY ("target_release_id") REFERENCES "releases"("id") ON DELETE SET NULL;