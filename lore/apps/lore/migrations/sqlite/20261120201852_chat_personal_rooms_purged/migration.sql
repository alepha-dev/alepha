-- #Q3972: Ask AI is the dock again, so the members' personal rooms with Lore (#Q3942) are purged,
-- children first. The columns `personal_of` and `agent` stay: a drop ships alone.
-- Their runs stay in `ai_*` until retention deletes them; a file attached in one is left to the files' own cleanup.
DELETE FROM `chat_reactions` WHERE `room_id` IN (SELECT `id` FROM `chat_rooms` WHERE `personal_of` IS NOT NULL);--> statement-breakpoint
DELETE FROM `chat_mentions` WHERE `room_id` IN (SELECT `id` FROM `chat_rooms` WHERE `personal_of` IS NOT NULL);--> statement-breakpoint
DELETE FROM `chat_room_members` WHERE `room_id` IN (SELECT `id` FROM `chat_rooms` WHERE `personal_of` IS NOT NULL);--> statement-breakpoint
DELETE FROM `chat_messages` WHERE `room_id` IN (SELECT `id` FROM `chat_rooms` WHERE `personal_of` IS NOT NULL);--> statement-breakpoint
DELETE FROM `chat_rooms` WHERE `personal_of` IS NOT NULL;
