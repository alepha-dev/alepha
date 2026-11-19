ALTER TABLE "chat_messages" ADD COLUMN "agent_run" jsonb;--> statement-breakpoint
ALTER TABLE "chat_room_members" ADD COLUMN "ai_conversation_id" uuid;