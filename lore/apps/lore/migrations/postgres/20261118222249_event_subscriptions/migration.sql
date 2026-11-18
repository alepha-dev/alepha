CREATE TABLE "event_subscriptions" (
	"id" uuid PRIMARY KEY,
	"project_id" integer NOT NULL,
	"key" text NOT NULL,
	"event" text NOT NULL,
	"filter" text,
	"member_id" uuid,
	"channels" text[] NOT NULL,
	"created_by" uuid,
	"muted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "event_subscriptions_project_id_key_idx" ON "event_subscriptions" ("project_id","key");--> statement-breakpoint
CREATE INDEX "event_subscriptions_project_id_event_idx" ON "event_subscriptions" ("project_id","event");--> statement-breakpoint
CREATE INDEX "event_subscriptions_member_id_idx" ON "event_subscriptions" ("member_id");--> statement-breakpoint
ALTER TABLE "event_subscriptions" ADD CONSTRAINT "event_subscriptions_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "event_subscriptions" ADD CONSTRAINT "event_subscriptions_member_id_users_id_fkey" FOREIGN KEY ("member_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "event_subscriptions" ADD CONSTRAINT "event_subscriptions_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
-- Notifications (#E159, #Q3890): `subscription:manage` wherever
-- `automation:manage` is held, `subscription:read` wherever
-- `automation:read` is, and `subscription:*` for `automation:*`, in ranks
-- and API keys. A stored rank is never reseeded.
UPDATE "organization_ranks" SET "permissions" = array_append("permissions", 'subscription:manage')
WHERE 'automation:manage' = ANY("permissions") AND NOT 'subscription:manage' = ANY("permissions");--> statement-breakpoint
UPDATE "organization_ranks" SET "permissions" = array_append("permissions", 'subscription:read')
WHERE 'automation:read' = ANY("permissions") AND NOT 'subscription:read' = ANY("permissions");--> statement-breakpoint
UPDATE "organization_ranks" SET "permissions" = array_append("permissions", 'subscription:*')
WHERE 'automation:*' = ANY("permissions") AND NOT 'subscription:*' = ANY("permissions");--> statement-breakpoint
UPDATE "api_keys" SET "permissions" = array_append("permissions", 'subscription:manage')
WHERE 'automation:manage' = ANY("permissions") AND NOT 'subscription:manage' = ANY("permissions");--> statement-breakpoint
UPDATE "api_keys" SET "permissions" = array_append("permissions", 'subscription:read')
WHERE 'automation:read' = ANY("permissions") AND NOT 'subscription:read' = ANY("permissions");--> statement-breakpoint
UPDATE "api_keys" SET "permissions" = array_append("permissions", 'subscription:*')
WHERE 'automation:*' = ANY("permissions") AND NOT 'subscription:*' = ANY("permissions");
