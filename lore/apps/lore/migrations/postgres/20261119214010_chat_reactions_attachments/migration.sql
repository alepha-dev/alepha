CREATE TABLE "chat_reactions" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"message_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"emoji" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "attachments" text[];--> statement-breakpoint
CREATE UNIQUE INDEX "chat_reactions_message_id_user_id_emoji_idx" ON "chat_reactions" ("message_id","user_id","emoji");--> statement-breakpoint
CREATE INDEX "chat_reactions_user_id_idx" ON "chat_reactions" ("user_id");--> statement-breakpoint
ALTER TABLE "chat_reactions" ADD CONSTRAINT "chat_reactions_message_id_chat_messages_id_fkey" FOREIGN KEY ("message_id") REFERENCES "chat_messages"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "chat_reactions" ADD CONSTRAINT "chat_reactions_room_id_chat_rooms_id_fkey" FOREIGN KEY ("room_id") REFERENCES "chat_rooms"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "chat_reactions" ADD CONSTRAINT "chat_reactions_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;