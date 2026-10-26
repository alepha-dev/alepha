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
CREATE TABLE `alepha_sequences` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`name` text NOT NULL,
	`scope` text DEFAULT 'default' NOT NULL,
	`value` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `job_executions` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`job_name` text NOT NULL,
	`key` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 1 NOT NULL,
	`redispatch_count` integer DEFAULT 0 NOT NULL,
	`payload` text,
	`scheduled_at` integer,
	`started_at` integer,
	`completed_at` integer,
	`error` text,
	`logs` text,
	`triggered_by` text,
	`triggered_by_name` text,
	`cancelled_by` text,
	`cancelled_by_name` text
);
--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`text` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `parameters` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`name` text NOT NULL,
	`content` text NOT NULL,
	`schema_hash` text NOT NULL,
	`activation_date` integer NOT NULL,
	`version` integer NOT NULL,
	`change_description` text,
	`tags` text,
	`creator_id` text,
	`creator_name` text,
	`previous_content` text,
	`migration_log` text
);
--> statement-breakpoint
CREATE INDEX `ai_conversations_user_id_updated_at_idx` ON `ai_conversations` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `ai_conversations_updated_at_idx` ON `ai_conversations` (`updated_at`);--> statement-breakpoint
CREATE INDEX `ai_messages_user_id_created_at_idx` ON `ai_messages` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_messages_conversation_id_seq_idx` ON `ai_messages` (`conversation_id`,`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `alepha_sequences_name_scope_idx` ON `alepha_sequences` (`name`,`scope`);--> statement-breakpoint
CREATE INDEX `job_executions_status_scheduled_at_idx` ON `job_executions` (`status`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `job_executions_status_updated_at_idx` ON `job_executions` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `job_executions_job_name_status_scheduled_at_idx` ON `job_executions` (`job_name`,`status`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `job_executions_job_name_status_created_at_idx` ON `job_executions` (`job_name`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `job_executions_job_name_started_at_idx` ON `job_executions` (`job_name`,`started_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `job_executions_job_name_key_idx` ON `job_executions` (`job_name`,`key`);--> statement-breakpoint
CREATE INDEX `parameters_name_activation_date_idx` ON `parameters` (`name`,`activation_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `parameters_name_version_idx` ON `parameters` (`name`,`version`);--> statement-breakpoint
CREATE INDEX `parameters_activation_date_idx` ON `parameters` (`activation_date`);