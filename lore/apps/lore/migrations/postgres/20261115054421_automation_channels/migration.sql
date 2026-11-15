CREATE TABLE "automation_channels" (
	"id" text PRIMARY KEY,
	"project_id" integer NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "automation_channels_project_id_name_idx" ON "automation_channels" ("project_id","name");--> statement-breakpoint
ALTER TABLE "automation_channels" ADD CONSTRAINT "automation_channels_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "automation_channels" ADD CONSTRAINT "automation_channels_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;