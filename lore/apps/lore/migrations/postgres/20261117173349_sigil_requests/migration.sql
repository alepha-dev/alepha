CREATE TABLE "analytics_sigil_requests_raw" (
	"time_bucket" text NOT NULL,
	"sigil_id" uuid NOT NULL,
	"route" text NOT NULL,
	"method" text NOT NULL,
	"status" text NOT NULL,
	"bucket" double precision NOT NULL,
	"samples" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_sigil_requests_rolled" (
	"time_bucket" text NOT NULL,
	"sigil_id" uuid NOT NULL,
	"route" text NOT NULL,
	"method" text NOT NULL,
	"status" text NOT NULL,
	"bucket" double precision NOT NULL,
	"samples" double precision NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_sigil_requests_raw_time_bucket_bucket_method_route_sigil_id_status_idx" ON "analytics_sigil_requests_raw" ("time_bucket","bucket","method","route","sigil_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_sigil_requests_rolled_time_bucket_bucket_method_route_sigil_id_status_idx" ON "analytics_sigil_requests_rolled" ("time_bucket","bucket","method","route","sigil_id","status");--> statement-breakpoint
ALTER TABLE "analytics_sigil_requests_raw" ADD CONSTRAINT "analytics_sigil_requests_raw_sigil_id_sigils_id_fkey" FOREIGN KEY ("sigil_id") REFERENCES "sigils"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "analytics_sigil_requests_rolled" ADD CONSTRAINT "analytics_sigil_requests_rolled_sigil_id_sigils_id_fkey" FOREIGN KEY ("sigil_id") REFERENCES "sigils"("id") ON DELETE CASCADE;