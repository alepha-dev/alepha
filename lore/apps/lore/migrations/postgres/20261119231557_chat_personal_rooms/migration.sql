ALTER TABLE "chat_rooms" ADD COLUMN "personal_of" uuid;--> statement-breakpoint
ALTER TABLE "chat_rooms" ADD COLUMN "agent" text;--> statement-breakpoint
CREATE INDEX "chat_rooms_project_id_personal_of_idx" ON "chat_rooms" ("project_id","personal_of");--> statement-breakpoint
ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_personal_of_users_id_fkey" FOREIGN KEY ("personal_of") REFERENCES "users"("id") ON DELETE CASCADE;