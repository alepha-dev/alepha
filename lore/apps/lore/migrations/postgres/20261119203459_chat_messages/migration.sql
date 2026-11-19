CREATE TABLE "chat_mentions" (
	"id" uuid PRIMARY KEY,
	"message_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"user_id" uuid,
	"agent" text
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"room_id" uuid NOT NULL,
	"author_id" uuid,
	"agent" text,
	"body" text NOT NULL,
	"references" text[] DEFAULT '{}'::text[] NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"ai_message_id" uuid
);
--> statement-breakpoint
CREATE INDEX "chat_mentions_user_id_room_id_message_id_idx" ON "chat_mentions" ("user_id","room_id","message_id");--> statement-breakpoint
CREATE INDEX "chat_mentions_message_id_idx" ON "chat_mentions" ("message_id");--> statement-breakpoint
CREATE INDEX "chat_messages_room_id_id_idx" ON "chat_messages" ("room_id","id");--> statement-breakpoint
CREATE INDEX "chat_messages_author_id_idx" ON "chat_messages" ("author_id");--> statement-breakpoint
ALTER TABLE "chat_mentions" ADD CONSTRAINT "chat_mentions_message_id_chat_messages_id_fkey" FOREIGN KEY ("message_id") REFERENCES "chat_messages"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "chat_mentions" ADD CONSTRAINT "chat_mentions_room_id_chat_rooms_id_fkey" FOREIGN KEY ("room_id") REFERENCES "chat_rooms"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "chat_mentions" ADD CONSTRAINT "chat_mentions_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_room_id_chat_rooms_id_fkey" FOREIGN KEY ("room_id") REFERENCES "chat_rooms"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_author_id_users_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL;