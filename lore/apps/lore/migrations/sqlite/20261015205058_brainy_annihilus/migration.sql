ALTER TABLE `automations` ADD `author_session_id` text;--> statement-breakpoint
ALTER TABLE `automations` ADD `author_scope` text;--> statement-breakpoint
ALTER TABLE `automations` ADD `approved_variables` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `automations` ADD `activated_at` integer;