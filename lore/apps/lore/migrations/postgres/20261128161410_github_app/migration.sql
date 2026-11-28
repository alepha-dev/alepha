CREATE TABLE "github_apps" (
	"id" text PRIMARY KEY,
	"app_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"html_url" text NOT NULL,
	"owner_login" text,
	"client_id" text NOT NULL,
	"client_secret" text NOT NULL,
	"private_key" text NOT NULL,
	"webhook_secret" text NOT NULL,
	"credential_key_version" integer NOT NULL,
	"webhook_ping_at" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_states" (
	"id" uuid PRIMARY KEY,
	"purpose" text NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" integer,
	"expires_at" text NOT NULL,
	"used_at" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "github_states_expires_at_idx" ON "github_states" ("expires_at");--> statement-breakpoint
ALTER TABLE "github_apps" ADD CONSTRAINT "github_apps_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "github_states" ADD CONSTRAINT "github_states_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "github_states" ADD CONSTRAINT "github_states_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;