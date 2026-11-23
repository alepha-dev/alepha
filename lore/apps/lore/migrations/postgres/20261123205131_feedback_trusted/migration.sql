ALTER TABLE "feedback" ADD COLUMN "trusted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "trusted_by" uuid;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_trusted_by_users_id_fkey" FOREIGN KEY ("trusted_by") REFERENCES "users"("id") ON DELETE SET NULL;