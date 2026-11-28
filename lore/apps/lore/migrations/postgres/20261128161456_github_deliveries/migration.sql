CREATE TABLE "github_deliveries" (
	"id" text PRIMARY KEY,
	"event" text NOT NULL,
	"action" text,
	"installation_id" integer,
	"repository_id" integer,
	"repository" text,
	"project_id" integer,
	"status" text NOT NULL,
	"attempts" integer NOT NULL,
	"last_error" text,
	"payload" text,
	"received_at" text NOT NULL,
	"handled_at" text
);
--> statement-breakpoint
CREATE TABLE "github_redeliveries" (
	"id" text PRIMARY KEY,
	"hook_delivery_id" integer NOT NULL,
	"asked_at" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "github_deliveries_status_received_at_idx" ON "github_deliveries" ("status","received_at");--> statement-breakpoint
CREATE INDEX "github_deliveries_received_at_idx" ON "github_deliveries" ("received_at");--> statement-breakpoint
CREATE INDEX "github_redeliveries_asked_at_idx" ON "github_redeliveries" ("asked_at");