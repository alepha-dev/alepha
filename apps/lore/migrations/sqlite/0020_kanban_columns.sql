ALTER TABLE `campaigns` ADD `kanban_columns` text DEFAULT '["In Progress"]' NOT NULL;--> statement-breakpoint
ALTER TABLE `quests` ADD `kanban_column` text;
