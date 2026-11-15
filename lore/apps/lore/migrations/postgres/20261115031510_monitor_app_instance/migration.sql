ALTER TABLE "monitors" ADD COLUMN "app_instance_id" uuid;--> statement-breakpoint
CREATE INDEX "monitors_app_instance_id_idx" ON "monitors" ("app_instance_id");--> statement-breakpoint
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_app_instance_id_app_instances_id_fkey" FOREIGN KEY ("app_instance_id") REFERENCES "app_instances"("id") ON DELETE CASCADE;