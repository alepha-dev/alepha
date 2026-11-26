CREATE TABLE "comments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "comments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"project_id" integer NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" integer NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"edited_at" timestamp with time zone,
	"attachments" text[],
	"source" jsonb
);
--> statement-breakpoint
CREATE INDEX "comments_subject_type_subject_id_created_at_idx" ON "comments" ("subject_type","subject_id","created_at");--> statement-breakpoint
CREATE INDEX "comments_project_id_created_at_idx" ON "comments" ("project_id","created_at");--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_users_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL;