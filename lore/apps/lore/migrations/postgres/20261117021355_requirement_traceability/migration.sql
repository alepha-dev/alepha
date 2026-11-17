ALTER TYPE "project_prompts_kind_enum" ADD VALUE 'useCaseDraft';--> statement-breakpoint
CREATE TABLE "requirement_technical_epics" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "requirement_technical_epics_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"project_id" integer NOT NULL,
	"epic_id" integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "requirement_technical_epics_epic_id_idx" ON "requirement_technical_epics" ("epic_id");--> statement-breakpoint
ALTER TABLE "requirement_technical_epics" ADD CONSTRAINT "requirement_technical_epics_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "requirement_technical_epics" ADD CONSTRAINT "requirement_technical_epics_epic_id_epics_id_fkey" FOREIGN KEY ("epic_id") REFERENCES "epics"("id") ON DELETE CASCADE;