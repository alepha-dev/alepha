CREATE TABLE "sigil_sessions" (
	"id" uuid PRIMARY KEY,
	"sigil_id" uuid NOT NULL,
	"period" text NOT NULL,
	"period_ends_at" text NOT NULL,
	"visitor_hash" text,
	"first_seen_at" text NOT NULL,
	"last_seen_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sigil_visits" (
	"id" uuid PRIMARY KEY,
	"sigil_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"started_at" text NOT NULL,
	"last_seen_at" text NOT NULL,
	"views" integer NOT NULL,
	"engaged" boolean NOT NULL,
	"entry_path" text NOT NULL,
	"exit_path" text NOT NULL,
	"referrer" text NOT NULL,
	"campaign" text NOT NULL,
	"country" text NOT NULL,
	"device" text NOT NULL,
	"browser" text NOT NULL,
	"os" text NOT NULL,
	"traffic" text NOT NULL,
	"auth" text NOT NULL,
	"network" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sigil_sessions_sigil_id_period_visitor_hash_idx" ON "sigil_sessions" ("sigil_id","period","visitor_hash");--> statement-breakpoint
CREATE INDEX "sigil_sessions_period_ends_at_idx" ON "sigil_sessions" ("period_ends_at");--> statement-breakpoint
CREATE INDEX "sigil_sessions_last_seen_at_idx" ON "sigil_sessions" ("last_seen_at");--> statement-breakpoint
CREATE INDEX "sigil_visits_sigil_id_started_at_idx" ON "sigil_visits" ("sigil_id","started_at");--> statement-breakpoint
CREATE INDEX "sigil_visits_session_id_last_seen_at_idx" ON "sigil_visits" ("session_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "sigil_visits_last_seen_at_idx" ON "sigil_visits" ("last_seen_at");--> statement-breakpoint
ALTER TABLE "sigil_sessions" ADD CONSTRAINT "sigil_sessions_sigil_id_sigils_id_fkey" FOREIGN KEY ("sigil_id") REFERENCES "sigils"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sigil_visits" ADD CONSTRAINT "sigil_visits_sigil_id_sigils_id_fkey" FOREIGN KEY ("sigil_id") REFERENCES "sigils"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sigil_visits" ADD CONSTRAINT "sigil_visits_session_id_sigil_sessions_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sigil_sessions"("id") ON DELETE CASCADE;