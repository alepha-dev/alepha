ALTER TABLE "event_subscriptions" ADD COLUMN "not_mine" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "project_events" ADD COLUMN "actor_id" uuid;