CREATE TABLE "analytics_sigil_pageviews_events" (
	"sigil_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"path" text NOT NULL,
	"country" text NOT NULL,
	"device" text NOT NULL,
	"browser" text NOT NULL,
	"os" text NOT NULL,
	"referrer" text NOT NULL,
	"campaign" text NOT NULL,
	"traffic" text NOT NULL,
	"auth" text NOT NULL,
	"network" text,
	"views" integer NOT NULL,
	"engaged" integer NOT NULL,
	"event_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "analytics_sigil_pageviews_events_sigil_id_event_at_idx" ON "analytics_sigil_pageviews_events" ("sigil_id","event_at");--> statement-breakpoint
ALTER TABLE "analytics_sigil_pageviews_events" ADD CONSTRAINT "analytics_sigil_pageviews_events_sigil_id_sigils_id_fkey" FOREIGN KEY ("sigil_id") REFERENCES "sigils"("id") ON DELETE CASCADE;