CREATE TABLE "chapters" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "chapters_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"project_id" integer NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "chapter_id" integer;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chapters_project_id_idx" ON "chapters" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chapters_project_id_number_idx" ON "chapters" USING btree ("project_id","number");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE set null ON UPDATE no action;