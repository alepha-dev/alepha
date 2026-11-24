DROP INDEX IF EXISTS `chat_lore_engines_project_id_idx`;--> statement-breakpoint
-- alepha-allow-drop-table: @lore's host engine is removed (#Q4273); a leaf, referenced by nothing, no data kept
DROP TABLE `chat_lore_engines`;--> statement-breakpoint
ALTER TABLE `agent_automations` DROP COLUMN `room`;--> statement-breakpoint
ALTER TABLE `chat_agents` DROP COLUMN `engine`;--> statement-breakpoint
ALTER TABLE `chat_agents` DROP COLUMN `engine_host`;--> statement-breakpoint
ALTER TABLE `chat_agents` DROP COLUMN `engine_agent`;--> statement-breakpoint
ALTER TABLE `chat_agents` DROP COLUMN `engine_model`;--> statement-breakpoint
ALTER TABLE `chat_room_members` DROP COLUMN `host_sessions`;