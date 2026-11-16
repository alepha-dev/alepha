CREATE TABLE "personas" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "personas_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"project_id" integer NOT NULL,
	"number" integer NOT NULL,
	"kind" text DEFAULT 'human' NOT NULL,
	"name" text NOT NULL,
	"role" text,
	"who" text DEFAULT '' NOT NULL,
	"goals" text DEFAULT '' NOT NULL,
	"frustrations" text DEFAULT '' NOT NULL,
	"alepha_role" text,
	"demo_account" text,
	"demo_seed" text,
	"environment_app" text,
	"environment_env" text,
	"areas" text[] DEFAULT '{}'::text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requirements_comments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "requirements_comments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"project_id" integer NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_id" integer NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"agent_client" text,
	"by_agent" boolean
);
--> statement-breakpoint
CREATE UNIQUE INDEX "personas_project_id_number_idx" ON "personas" ("project_id","number");--> statement-breakpoint
CREATE INDEX "requirements_comments_subject_kind_subject_id_created_at_idx" ON "requirements_comments" ("subject_kind","subject_id","created_at");--> statement-breakpoint
ALTER TABLE "personas" ADD CONSTRAINT "personas_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "requirements_comments" ADD CONSTRAINT "requirements_comments_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "requirements_comments" ADD CONSTRAINT "requirements_comments_author_id_users_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL;