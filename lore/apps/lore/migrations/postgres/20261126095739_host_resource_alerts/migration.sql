ALTER TABLE "hosts" ADD COLUMN "alert_disk_percent" integer;--> statement-breakpoint
ALTER TABLE "hosts" ADD COLUMN "alert_memory_percent" integer;--> statement-breakpoint
ALTER TABLE "hosts" ADD COLUMN "resource_alerts" jsonb;