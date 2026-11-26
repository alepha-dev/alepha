CREATE TABLE "project_error_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "project_error_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"project_error_id" integer NOT NULL,
	"kind" text NOT NULL,
	"actor_id" uuid,
	"quest_id" integer
);
--> statement-breakpoint
CREATE INDEX "project_error_events_project_error_id_created_at_idx" ON "project_error_events" ("project_error_id","created_at");--> statement-breakpoint
ALTER TABLE "project_error_events" ADD CONSTRAINT "project_error_events_project_error_id_project_errors_id_fkey" FOREIGN KEY ("project_error_id") REFERENCES "project_errors"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "project_error_events" ADD CONSTRAINT "project_error_events_actor_id_users_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL;