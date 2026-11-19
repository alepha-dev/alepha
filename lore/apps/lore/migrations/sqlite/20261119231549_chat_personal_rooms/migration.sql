ALTER TABLE `chat_rooms` ADD `personal_of` text REFERENCES users(id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `chat_rooms` ADD `agent` text;--> statement-breakpoint
CREATE INDEX `chat_rooms_project_id_personal_of_idx` ON `chat_rooms` (`project_id`,`personal_of`);