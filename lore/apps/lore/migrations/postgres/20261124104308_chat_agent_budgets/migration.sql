CREATE TABLE "chat_agent_budgets" (
	"id" uuid PRIMARY KEY,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"project_id" integer NOT NULL,
	"tokens" integer NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "chat_agent_charges" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"project_id" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"conversation_id" uuid,
	"tokens" integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "chat_agent_budgets_project_id_idx" ON "chat_agent_budgets" ("project_id");--> statement-breakpoint
CREATE INDEX "chat_agent_charges_project_id_created_at_idx" ON "chat_agent_charges" ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_agent_charges_user_id_created_at_idx" ON "chat_agent_charges" ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "chat_agent_budgets" ADD CONSTRAINT "chat_agent_budgets_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "chat_agent_budgets" ADD CONSTRAINT "chat_agent_budgets_updated_by_users_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "chat_agent_charges" ADD CONSTRAINT "chat_agent_charges_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;