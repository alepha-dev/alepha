ALTER TABLE "automation_channels" RENAME TO "notification_channels";--> statement-breakpoint
ALTER INDEX "automation_channels_project_id_name_idx" RENAME TO "notification_channels_project_id_name_idx";--> statement-breakpoint
ALTER TABLE "event_subscriptions" ADD COLUMN "channel_id" text;--> statement-breakpoint
ALTER TABLE "event_subscriptions" ADD CONSTRAINT "event_subscriptions_channel_id_notification_channels_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "notification_channels"("id") ON DELETE CASCADE;