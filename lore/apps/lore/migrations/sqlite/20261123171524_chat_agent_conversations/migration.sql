-- Chat agents (#E170, #Q4197): a member's run log per room AND agent. The
-- one conversation each member had in a room was `@lore`'s, so it moves
-- under the `lore` key. `ai_conversation_id` stays, unread, until its drop
-- ships alone.
ALTER TABLE `chat_room_members` ADD `ai_conversations` text;--> statement-breakpoint
UPDATE `chat_room_members` SET `ai_conversations` = json_object('lore', `ai_conversation_id`)
WHERE `ai_conversation_id` IS NOT NULL AND `ai_conversations` IS NULL;
