ALTER TABLE "analytics_host_stats_raw" ADD COLUMN "disk" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "analytics_host_stats_raw" ADD COLUMN "disk_samples" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "analytics_host_stats_raw" ADD COLUMN "load" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "analytics_host_stats_raw" ADD COLUMN "load_samples" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "analytics_host_stats_rolled" ADD COLUMN "disk" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "analytics_host_stats_rolled" ADD COLUMN "disk_samples" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "analytics_host_stats_rolled" ADD COLUMN "load" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "analytics_host_stats_rolled" ADD COLUMN "load_samples" double precision DEFAULT 0 NOT NULL;