CREATE TYPE "webhook_deliveries_status_enum" AS ENUM('pending', 'delivered', 'failed');--> statement-breakpoint
CREATE TYPE "webhook_endpoints_disabled_reason_enum" AS ENUM('gone', 'failing', 'secret');--> statement-breakpoint
CREATE TYPE "webhook_endpoints_status_enum" AS ENUM('active', 'paused', 'disabled');--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"event_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "webhook_deliveries_status_enum" DEFAULT 'pending'::"webhook_deliveries_status_enum" NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"response_status" integer,
	"response_excerpt" text,
	"duration_ms" integer,
	"delivered_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" uuid PRIMARY KEY,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"url" text NOT NULL,
	"description" text,
	"events" text[] DEFAULT '{}'::text[] NOT NULL,
	"secret" text NOT NULL,
	"previous_secret" text,
	"secret_prefix" text NOT NULL,
	"previous_secret_expires_at" timestamp with time zone,
	"status" "webhook_endpoints_status_enum" DEFAULT 'active'::"webhook_endpoints_status_enum" NOT NULL,
	"disabled_reason" "webhook_endpoints_disabled_reason_enum",
	"scope" text,
	"created_by" uuid,
	"failing_since" timestamp with time zone,
	"last_delivery_at" timestamp with time zone,
	"last_success_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "notification_channels" ADD COLUMN "endpoint_id" uuid;--> statement-breakpoint
CREATE INDEX "webhook_deliveries_endpoint_id_created_at_idx" ON "webhook_deliveries" ("endpoint_id","created_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_event_type_created_at_idx" ON "webhook_deliveries" ("event_type","created_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_status_idx" ON "webhook_deliveries" ("status");--> statement-breakpoint
CREATE INDEX "webhook_endpoints_status_idx" ON "webhook_endpoints" ("status");--> statement-breakpoint
CREATE INDEX "webhook_endpoints_scope_idx" ON "webhook_endpoints" ("scope");--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE;