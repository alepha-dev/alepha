CREATE TABLE `ai_conversations` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`user_id` text NOT NULL,
	`title` text,
	`pending_call_id` text,
	`pending_call` text
);
--> statement-breakpoint
CREATE TABLE `ai_messages` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`conversation_id` text NOT NULL,
	`user_id` text NOT NULL,
	`seq` integer NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`tool_calls` text,
	`call_id` text,
	`name` text,
	`is_error` integer,
	`vendor` text,
	`model` text,
	`input_tokens` integer,
	`output_tokens` integer
);
--> statement-breakpoint
CREATE INDEX `ai_conversations_user_id_updated_at_idx` ON `ai_conversations` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `ai_conversations_updated_at_idx` ON `ai_conversations` (`updated_at`);--> statement-breakpoint
CREATE INDEX `ai_messages_user_id_created_at_idx` ON `ai_messages` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_messages_conversation_id_seq_idx` ON `ai_messages` (`conversation_id`,`seq`);